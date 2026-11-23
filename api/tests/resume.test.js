import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Writable } from "node:stream";

import { internalStream } from "../src/stream/internal.js";

// a file server like youtube's: HEAD for the size, ranges for the chunks
const file = Buffer.from(Array.from({ length: 300000 }, (_, i) => i % 251));

const server = http.createServer((req, res) => {
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;

    res.setHeader("content-type", "video/mp4");
    res.setHeader("content-length", end - start + 1);
    res.statusCode = range ? 206 : 200;
    if (req.method === "HEAD") return res.end();
    res.end(file.subarray(start, end + 1));
});

const listen = () => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

// a minimal express-like response that collects what's written
const response = () => {
    const chunks = [];
    const res = new Writable({
        write(chunk, _, callback) {
            chunks.push(chunk);
            callback();
        }
    });
    res.statusCode = 200;
    res.headers = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = String(value); };
    res.body = () => Buffer.concat(chunks);
    res.done = new Promise(resolve => res.on("finish", resolve));
    return res;
}

const tunnel = (headers = {}) => ({
    url: `http://127.0.0.1:${server.address().port}/video.mp4`,
    service: "youtube",
    headers: new Map(Object.entries(headers)),
    controller: new AbortController(),
});

test("chunked streams (youtube) can continue from a byte offset", async (t) => {
    await listen();
    t.after(() => server.close());

    // the whole file
    const full = response();
    await internalStream(tunnel(), full);
    await full.done;
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.equal(full.headers["content-length"], String(file.length));
    assert.ok(full.body().equals(file));

    // continuing after the first 123456 bytes
    const rest = response();
    await internalStream(tunnel({ range: "bytes=123456-" }), rest);
    await rest.done;
    assert.equal(rest.statusCode, 206);
    assert.equal(rest.headers["content-range"], `bytes 123456-${file.length - 1}/${file.length}`);
    assert.equal(rest.headers["content-length"], String(file.length - 123456));
    assert.ok(rest.body().equals(file.subarray(123456)));

    // a range past the end
    const past = response();
    await internalStream(tunnel({ range: `bytes=${file.length}-` }), past);
    await past.done;
    assert.equal(past.statusCode, 416);
});

test("a client going away doesn't end the tunnel", async (t) => {
    if (!server.listening) await listen();
    t.after(() => server.close());

    const info = tunnel();
    const res = response();
    await internalStream(info, res);
    // the client disconnects before reading everything
    res.destroy();
    await new Promise(r => setTimeout(r, 50));

    // the tunnel's own controller isn't aborted, it can be requested again
    assert.equal(info.controller.signal.aborted, false);

    const again = response();
    await internalStream(info, again);
    await again.done;
    assert.ok(again.body().equals(file));
});
