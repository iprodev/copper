import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Writable } from "node:stream";

import hlsTunnel from "../src/stream/hls-tunnel.js";
import { createProxyTunnels, verifyStream } from "../src/stream/manage.js";
import { setupTunnelHandler } from "../src/core/itunnel.js";

// one file with all segments, served in byte ranges
const media = Buffer.from(Array.from({ length: 3000 }, (_, i) => i % 251));
const key = Buffer.from("0123456789abcdef");

const playlists = {
    "/master.m3u8": [
        "#EXTM3U",
        "#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360",
        "low.m3u8",
        "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1920x1080",
        "high.m3u8",
    ],
    "/high.m3u8": [
        "#EXTM3U",
        "#EXT-X-VERSION:4",
        "#EXT-X-TARGETDURATION:4",
        "#EXT-X-MEDIA-SEQUENCE:7",
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x000102030405060708090a0b0c0d0e0f',
        "#EXTINF:4.0,",
        "#EXT-X-BYTERANGE:1000@0",
        "media.bin",
        "#EXTINF:4.0,",
        "#EXT-X-BYTERANGE:1000",
        "media.bin",
        "#EXT-X-KEY:METHOD=NONE",
        "#EXTINF:2.5,",
        "#EXT-X-BYTERANGE:1000",
        "media.bin",
        "#EXT-X-ENDLIST",
    ],
    "/missing.m3u8": [
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:4",
        "#EXTINF:4.0,",
        "gone.ts",
        "#EXT-X-ENDLIST",
    ],
    "/live.m3u8": [
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:4",
        "#EXTINF:4.0,",
        "segment.ts",
    ],
    "/sample-aes.m3u8": [
        "#EXTM3U",
        "#EXT-X-TARGETDURATION:4",
        '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"',
        "#EXTINF:4.0,",
        "segment.ts",
        "#EXT-X-ENDLIST",
    ],
};

const origin = http.createServer((req, res) => {
    if (playlists[req.url]) {
        res.setHeader("content-type", "application/vnd.apple.mpegurl");
        return res.end(playlists[req.url].join("\n"));
    }

    if (req.url === "/key.bin") return res.end(key);

    if (req.url === "/media.bin") {
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
        if (!range) return res.end(media);
        const [ , start, end ] = range.map(Number);
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${start}-${end}/${media.length}`);
        return res.end(media.subarray(start, end + 1));
    }

    res.statusCode = 404;
    res.end();
});

let base, tunnelHandler;

before(async () => {
    await new Promise(resolve => origin.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${origin.address().port}`;
    // segments go through the internal tunnel handler, like in the api
    tunnelHandler = setupTunnelHandler();
    await new Promise(resolve => setTimeout(resolve, 200));
});

after(() => {
    origin.close();
    tunnelHandler.close();
});

// a minimal express-like response that collects what's written
const response = () => {
    const chunks = [];
    const res = new Writable({
        write(chunk, _, callback) {
            res.headersSent = true;
            chunks.push(Buffer.from(chunk));
            callback();
        }
    });
    res.statusCode = 200;
    res.headersSent = false;
    res.headers = {};
    res.sendStatus = (code) => { res.statusCode = code; res.end(); return res; };
    res.status = (code) => { res.statusCode = code; return res; };
    res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = String(value); };
    res.json = (value) => { res.end(JSON.stringify(value)); return res; };
    res.body = () => Buffer.concat(chunks);
    res.done = new Promise(resolve => res.on("finish", resolve));
    return res;
}

// what the api does for /tunnel?...&hls=...
const request = async (tunnel, query) => {
    const url = new URL(tunnel);
    const p = Object.fromEntries(url.searchParams);
    const streamInfo = await verifyStream(p.id, p.sig, p.exp, p.sec, p.iv);

    const res = response();
    await hlsTunnel(p.id, streamInfo, query, res);
    await res.done;
    return res;
}

const hlsTunnelFor = (path) => {
    const [ tunnel ] = createProxyTunnels({
        url: `${base}${path}`,
        service: "vimeo",
        isHLS: true,
    });
    return tunnel;
}

test("hls tunnels are marked and live longer", () => {
    const tunnel = hlsTunnelFor("/master.m3u8");
    const url = new URL(tunnel);

    assert.equal(url.searchParams.get("hls"), "1");
    // an hour instead of the usual 90 seconds
    assert.ok(Number(url.searchParams.get("exp")) - Date.now() > 3500 * 1000);
});

test("the index lists segments of the best variant, with keys and ivs", async () => {
    const tunnel = hlsTunnelFor("/master.m3u8");
    const res = await request(tunnel, { hls: "index" });
    const index = JSON.parse(res.body());

    assert.equal(res.statusCode, 200);
    assert.equal(index.format, "ts");
    assert.equal(index.map, false);
    assert.equal(index.keys, 1);
    assert.equal(index.duration, 10.5);
    assert.deepEqual(index.segments, [
        { duration: 4, sequence: 7, key: { index: 0, iv: "000102030405060708090a0b0c0d0e0f" } },
        { duration: 4, sequence: 8, key: { index: 0, iv: "000102030405060708090a0b0c0d0e0f" } },
        { duration: 2.5, sequence: 9 },
    ]);
});

test("segments (byte ranges) and keys are served", async () => {
    const tunnel = hlsTunnelFor("/master.m3u8");

    for (const n of [0, 1, 2]) {
        const res = await request(tunnel, { hls: "segment", n: String(n) });
        assert.equal(res.statusCode, 200, `segment ${n}`);
        assert.ok(res.body().equals(media.subarray(n * 1000, n * 1000 + 1000)), `segment ${n}`);
    }

    const keyRes = await request(tunnel, { hls: "key", n: "0" });
    assert.ok(keyRes.body().equals(key));

    // things that don't exist
    assert.equal((await request(tunnel, { hls: "segment", n: "3" })).statusCode, 400);
    assert.equal((await request(tunnel, { hls: "segment", n: "-1" })).statusCode, 400);
    assert.equal((await request(tunnel, { hls: "key", n: "1" })).statusCode, 400);
    assert.equal((await request(tunnel, { hls: "map" })).statusCode, 400);
    assert.equal((await request(tunnel, { hls: "something" })).statusCode, 400);
});

test("streams the browser can't handle are refused with 422", async () => {
    for (const path of ["/live.m3u8", "/sample-aes.m3u8"]) {
        const res = await request(hlsTunnelFor(path), { hls: "index" });
        assert.equal(res.statusCode, 422, path);
    }
});

test("segments the origin doesn't have end in 502", async () => {
    const res = await request(hlsTunnelFor("/missing.m3u8"), { hls: "segment", n: "0" });
    assert.equal(res.statusCode, 502);
});
