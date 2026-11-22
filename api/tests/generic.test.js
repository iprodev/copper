import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Writable } from "node:stream";

import { env } from "../src/config.js";
import { isPublicAddress, assertSafeURL } from "../src/security/network.js";
import { findMedia, findTitle, findImage } from "../src/processing/services/generic.js";
import generic from "../src/processing/services/generic.js";
import { extract, normalizeURL } from "../src/processing/url.js";
import { internalStream } from "../src/stream/internal.js";

const resolvesTo = (...addresses) => ({ resolve: async () => addresses });

const rejects = async (url, options) => {
    await assert.rejects(assertSafeURL(url, options), { name: "UnsafeURLError" }, url);
}

test("only public addresses are allowed", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
        assert.ok(isPublicAddress(address), address);
    }

    for (const address of [
        "127.0.0.1", "127.255.255.254", "10.0.0.1", "172.16.0.1", "192.168.1.1",
        "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
        "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
        "64:ff9b::7f00:1", "not an ip",
    ]) {
        assert.equal(isPublicAddress(address), false, address);
    }
});

test("internal urls are rejected, including disguised ones", async () => {
    for (const url of [
        "http://127.0.0.1/",
        "http://0x7f000001/",
        "http://2130706433/",
        "http://127.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5/",
        "http://192.168.0.1/admin",
        "http://0.0.0.0/",
    ]) {
        await rejects(url);
    }
});

test("hostnames are checked by what they resolve to", async () => {
    await rejects("http://evil.example/", resolvesTo("127.0.0.1"));
    await rejects("http://evil.example/", resolvesTo("169.254.169.254"));
    // one internal address is enough, the connection may land on it
    await rejects("http://evil.example/", resolvesTo("93.184.216.34", "10.0.0.1"));
    await rejects("http://evil.example/", resolvesTo());
    await rejects("http://evil.example/", { resolve: async () => { throw new Error("nxdomain") } });

    await assertSafeURL("https://good.example/video.mp4", resolvesTo("93.184.216.34"));
    await assertSafeURL("https://good.example/", resolvesTo("2001:4860:4860::8888"));
});

test("only http(s) on standard ports, without credentials", async () => {
    const pub = resolvesTo("93.184.216.34");

    for (const url of [
        "file:///etc/passwd",
        "ftp://good.example/",
        "gopher://good.example/",
        "data:text/plain,hi",
        "http://good.example:22/",
        "http://good.example:6379/",
        "https://good.example:8443/",
        "http://user:pass@good.example/",
        "not a url",
    ]) {
        await rejects(url, pub);
    }

    await assertSafeURL("http://good.example:80/", pub);
    await assertSafeURL("https://good.example:443/", pub);
});

test("media is found in pages", () => {
    const base = "https://site.example/watch/1";

    const html = `
        <html><head>
            <title>page title</title>
            <meta property="og:title" content="nice &amp; video">
            <meta property="og:image" content="/thumb.jpg">
            <meta property="og:video" content="https://cdn.example/og.mp4">
            <script type="application/ld+json">
                {"@type": "VideoObject", "contentUrl": "https://cdn.example/ld.mp4"}
            </script>
        </head><body>
            <video src="relative.webm"></video>
            <video><source src="/stream.m3u8" type="application/x-mpegURL"></video>
            <script>var data = {"url":"https:\\/\\/cdn.example\\/escaped.mp4?sig=1"};</script>
        </body></html>`;

    const media = findMedia(html, base);
    const urls = media.map(m => m.url);

    // regular video files first (json-ld, meta, tags, links), then hls
    assert.deepEqual(urls, [
        "https://cdn.example/ld.mp4",
        "https://cdn.example/og.mp4",
        "https://site.example/watch/relative.webm",
        "https://cdn.example/escaped.mp4?sig=1",
        "https://site.example/stream.m3u8",
    ]);
    assert.equal(media.at(-1).kind, "hls");

    assert.equal(findTitle(html), "nice & video");
    assert.equal(findImage(html, base), "https://site.example/thumb.jpg");
});

test("embedded web players and non-http urls are ignored", () => {
    const html = `
        <meta property="og:video" content="https://player.example/embed/1">
        <meta property="og:video:type" content="text/html">
        <video src="javascript:alert(1)"></video>
        <video src="file:///etc/passwd.mp4"></video>
        <audio src="/song.mp3"></audio>`;

    assert.deepEqual(
        findMedia(html, "https://site.example/").map(m => [m.url, m.kind]),
        [["https://site.example/song.mp3", "audio"]]
    );
});

test("unsupported sites go to the generic extractor only when enabled", () => {
    const url = "https://random.example/videos/42?id=7&sig=abc#frag";

    assert.equal(env.genericExtractor, false);
    assert.deepEqual(extract(normalizeURL(url)), { error: "link.invalid" });

    env.genericExtractor = true;
    try {
        const result = extract(normalizeURL(url));
        assert.equal(result.host, "generic");
        // query strings are kept for unknown sites, only the fragment is dropped
        assert.equal(result.patternMatch.url, "https://random.example/videos/42?id=7&sig=abc");

        // supported services still use their own extractors
        assert.equal(extract(normalizeURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).host, "youtube");

        // api keys with a service list need "generic" in it
        assert.deepEqual(extract(normalizeURL(url), new Set(["youtube"])), { error: "link.invalid" });
        assert.equal(extract(normalizeURL(url), new Set(["generic"])).host, "generic");
    } finally {
        env.genericExtractor = false;
    }
});

test("the generic extractor refuses internal servers", async (t) => {
    let requests = 0;
    const server = http.createServer((_, res) => {
        requests++;
        res.setHeader("content-type", "video/mp4");
        res.end("secret");
    }).listen(0, "127.0.0.1");
    await new Promise(r => server.on("listening", r));
    t.after(() => server.close());

    const { port } = server.address();
    for (const url of [`http://127.0.0.1:${port}/`, `http://localhost/`, "http://169.254.169.254/"]) {
        const result = await generic({ url });
        assert.deepEqual(result, { error: "link.invalid" }, url);
    }

    assert.equal(requests, 0);
});

test("generic tunnels refuse internal urls", async () => {
    const res = Object.assign(new Writable({ write(_, __, cb) { cb(); } }), {
        statusCode: 200,
        setHeader() {},
    });

    await internalStream({
        url: "http://169.254.169.254/latest/meta-data/",
        service: "generic",
        controller: new AbortController(),
        headers: new Map(),
    }, res);

    assert.equal(res.statusCode, 403);
});

after(() => {
    env.genericExtractor = false;
});
