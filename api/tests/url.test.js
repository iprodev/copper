import { test } from "node:test";
import assert from "node:assert/strict";

import { extract, normalizeURL } from "../src/processing/url.js";

const host = (url) => extract(normalizeURL(url));

test("youtube links are normalized", () => {
    const expected = "https://youtube.com/watch?v=dQw4w9WgXcQ";

    for (const url of [
        "https://youtube.com/watch?v=dQw4w9WgXcQ&list=x&t=10",
        "https://youtu.be/dQw4w9WgXcQ?si=abc",
        "https://youtube.com/shorts/dQw4w9WgXcQ",
        "https://youtube.com/live/dQw4w9WgXcQ?feature=share",
    ]) {
        assert.equal(normalizeURL(url).href, expected, url);
    }

    assert.equal(
        normalizeURL("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10").href,
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );

    const { host: service, patternMatch } = host("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(service, "youtube");
    assert.equal(patternMatch.id, "dQw4w9WgXcQ");
});

test("tracking data, credentials and fragments are stripped", () => {
    const url = normalizeURL("https://user:pass@www.instagram.com:8443/p/abc/?igsh=xyz#frag");
    assert.equal(url.href, "https://www.instagram.com/p/abc");
});

test("alternative domains map to the main service", () => {
    assert.equal(host("https://x.com/user/status/123").host, "twitter");
    assert.equal(host("https://vxtwitter.com/user/status/123").host, "twitter");
    assert.equal(host("https://clips.twitch.tv/SomeClip").host, "twitch");
    assert.equal(host("https://v.redd.it/abc123").host, "reddit");
});

test("unknown and fake hosts are rejected", () => {
    for (const url of [
        "https://example.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
        "https://evil.youtube.co/watch?v=dQw4w9WgXcQ",
        "https://bsky.com/profile/a/post/b",
    ]) {
        assert.deepEqual(host(url), { error: "link.invalid" }, url);
    }
});

test("unsupported path on a known service", () => {
    const result = host("https://youtube.com/channel/abc");
    assert.equal(result.error, "link.unsupported");
    assert.equal(result.context.service, "youtube");
});

test("disabled and key-restricted services", () => {
    const url = normalizeURL("https://youtube.com/watch?v=dQw4w9WgXcQ");

    assert.deepEqual(extract(url, new Set(["twitter"])), { error: "service.disabled" });
    assert.equal(extract(url, new Set(["youtube"])).host, "youtube");
});
