import { test } from "node:test";
import assert from "node:assert/strict";

import pornhub from "../src/processing/services/pornhub.js";
import { mp4Dimensions } from "../src/processing/services/xvideos.js";

// a "tkhd" box as it appears in an mp4's moov box
const tkhd = (version, width, height) => {
    const body = Buffer.alloc(version === 1 ? 96 : 84);
    body.writeUInt8(version, 0);
    const sizeAt = version === 1 ? 88 : 76;
    body.writeUInt32BE(width << 16, sizeAt);
    body.writeUInt32BE(height << 16, sizeAt + 4);

    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length + 8, 0);
    header.write("tkhd", 4);
    return Buffer.concat([header, body]);
}

test("the video size is read from the start of an mp4", () => {
    const start = Buffer.from("....ftypisom....moov");

    // a vertical video, and an audio track (0 x 0) before it
    assert.deepEqual(
        mp4Dimensions(Buffer.concat([start, tkhd(0, 0, 0), tkhd(0, 480, 854)])),
        { width: 480, height: 854 }
    );

    // version 1 boxes have longer times before the size
    assert.deepEqual(mp4Dimensions(Buffer.concat([start, tkhd(1, 1280, 720)])), { width: 1280, height: 720 });

    // no moov box at the start, or cut off in the middle
    assert.equal(mp4Dimensions(Buffer.from("....ftypisom....mdat")), undefined);
    assert.equal(mp4Dimensions(tkhd(0, 640, 360).subarray(0, 50)), undefined);
});

// a site like pornhub from a country with age verification laws: the hls
// files answer 410, the direct mp4 files only work with the page's cookies
// and the page as referer
const pornhubSite = (requests) => async (input, init = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    requests.push({ url: url.toString(), headers });

    const page = "https://www.pornhub.com/view_video.php?viewkey=ph123";

    if (url.pathname === "/view_video.php") {
        const flashvars = {
            video_title: "a title",
            video_duration: "60",
            mediaDefinitions: [
                { format: "hls", quality: "1080", videoUrl: "https://hls.example/1080/master.m3u8" },
                { format: "hls", quality: "480", videoUrl: "https://hls.example/480/master.m3u8" },
                { format: "mp4", videoUrl: "https://www.pornhub.com/video/get_media?s=abc" },
            ],
        };
        return new Response(`<script>var flashvars_123 = ${JSON.stringify(flashvars)};\n</script>`, {
            headers: [["set-cookie", "ss=1; path=/"], ["set-cookie", "platform=pc; path=/"]],
        });
    }

    if (url.hostname === "hls.example") return new Response("gone", { status: 410 });

    if (url.pathname === "/video/get_media") {
        const ok = headers.cookie === "ss=1; platform=pc" && headers.referer === page;
        return Response.json(ok ? [
            { quality: "720", videoUrl: "https://cdn.example/720.mp4" },
            { quality: "480", videoUrl: "https://cdn.example/480.mp4" },
            { quality: "240", videoUrl: "https://cdn.example/240.mp4" },
        ] : []);
    }

    if (url.hostname === "cdn.example") {
        return new Response("x", { status: headers.referer === page ? 206 : 404 });
    }

    return new Response("", { status: 404 });
}

test("pornhub: direct mp4 files where hls is blocked", async (t) => {
    const realFetch = globalThis.fetch;
    t.after(() => globalThis.fetch = realFetch);

    const requests = [];
    globalThis.fetch = pornhubSite(requests);

    const result = await pornhub({ id: "ph123", quality: "480" });

    assert.equal(result.urls, "https://cdn.example/480.mp4");
    assert.equal(result.isHLS, undefined);
    // the file needs the page as referer, so the tunnel sends it too
    assert.equal(result.headers.referer, "https://www.pornhub.com/view_video.php?viewkey=ph123");
    assert.equal(result.filenameAttributes.resolution, "480p");
    assert.equal(result.fileMetadata.title, "a title");

    // the best file for "max"
    assert.equal((await pornhub({ id: "ph123", quality: "max" })).urls, "https://cdn.example/720.mp4");

    // nothing better than the lowest when asked for less
    assert.equal((await pornhub({ id: "ph123", quality: "144" })).urls, "https://cdn.example/240.mp4");
});

test("pornhub: still a region error when there are no mp4 files either", async (t) => {
    const realFetch = globalThis.fetch;
    t.after(() => globalThis.fetch = realFetch);

    const site = pornhubSite([]);
    globalThis.fetch = (input, init) => new URL(input).pathname === "/video/get_media"
        ? Promise.resolve(Response.json([]))
        : site(input, init);

    assert.deepEqual(await pornhub({ id: "ph123", quality: "480" }), { error: "content.region" });
});
