import { test } from "node:test";
import assert from "node:assert/strict";

import { isHlsResponse } from "../src/stream/internal-hls.js";

const response = (contentType) => ({ headers: { "content-type": contentType } });
const info = { service: "loom", url: "https://cdn.example/a.m3u8?sig=1" };

test("hls playlists are detected regardless of parameters and case", () => {
    for (const type of [
        "application/vnd.apple.mpegurl",
        "application/vnd.apple.mpegurl; charset=utf-8",
        "application/x-mpegURL",
        "Audio/MPEGURL",
    ]) {
        assert.ok(isHlsResponse(response(type), info), type);
    }
});

test("other content types are not hls", () => {
    for (const type of ["video/mp4", "text/html; charset=utf-8", undefined]) {
        assert.equal(isHlsResponse(response(type), info), false, String(type));
    }
});

test("bluesky playlists are detected by extension", () => {
    assert.ok(isHlsResponse(response("text/plain"), { service: "bsky", url: "https://video.bsky.app/a/playlist.m3u8" }));
});
