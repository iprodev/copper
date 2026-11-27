import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { env } from "../src/config.js";
import { extract, normalizeURL } from "../src/processing/url.js";
import match from "../src/processing/match.js";
import matchAction from "../src/processing/match-action.js";
import ytdlp, { kindOf, pickFormats, parseCookies, headersFor } from "../src/processing/services/ytdlp.js";

// formats like yt-dlp gives for a ted talk: direct mp4 without known codecs,
// and hls video and audio separately
const ted = [
    { format_id: "hls-audio", url: "https://cdn/a.m3u8", protocol: "m3u8_native", ext: "mp4", vcodec: "none" },
    { format_id: "h264-1200k", url: "https://cdn/1200k.mp4", protocol: "https", ext: "mp4", tbr: 1200 },
    { format_id: "hls-180", url: "https://cdn/180.m3u8", protocol: "m3u8_native", ext: "mp4", vcodec: "avc1", acodec: "none", height: 180 },
    { format_id: "hls-480", url: "https://cdn/480.m3u8", protocol: "m3u8_native", ext: "mp4", vcodec: "avc1", acodec: "none", height: 480 },
    { format_id: "hls-1080", url: "https://cdn/1080.m3u8", protocol: "m3u8_native", ext: "mp4", vcodec: "avc1", acodec: "none", height: 1080 },
];

test("what a format is", () => {
    assert.equal(kindOf({ url: "u", protocol: "https", ext: "mp4" }), "both");
    assert.equal(kindOf({ url: "u", protocol: "https", ext: "mp3", vcodec: "none", acodec: "mp3" }), "audio");
    assert.equal(kindOf({ url: "u", protocol: "https", ext: "m4a" }), "audio");
    assert.equal(kindOf({ url: "u", protocol: "m3u8_native", ext: "mp4", vcodec: "avc1", acodec: "none" }), "video");
    assert.equal(kindOf({ url: "u", protocol: "https", ext: "gif", acodec: "none" }), "image");
    assert.equal(kindOf({ url: "https://cdn/a.m3u8", ext: "mp4" }), "both");

    // things fetchr can't download
    for (const f of [
        { url: "u", protocol: "http_dash_segments", ext: "mp4" },
        { url: "u", protocol: "rtmp", ext: "flv" },
        { url: "u", protocol: "mhtml", ext: "mhtml" },
        { url: "u", protocol: "https", ext: "mp4", has_drm: true },
        { url: "u", protocol: "https", ext: "mp4", vcodec: "none", acodec: "none" },
        { protocol: "https", ext: "mp4" },
    ]) {
        assert.equal(kindOf(f), undefined, JSON.stringify(f));
    }
});

test("formats are picked by quality, and joined when separate", () => {
    // the best video is only separate from its audio: both are joined
    assert.deepEqual(
        Object.fromEntries(Object.entries(pickFormats(ted, { quality: "max" })).map(([k, f]) => [k, f.format_id])),
        { video: "hls-1080", audio: "hls-audio" }
    );
    assert.equal(pickFormats(ted, { quality: "720" }).video.format_id, "hls-480");

    // nothing as small as asked for: the smallest there is
    assert.equal(pickFormats(ted, { quality: "144" }).video.format_id, "hls-180");

    // audio only
    assert.deepEqual(Object.keys(pickFormats(ted, { isAudioOnly: true })), ["audio"]);

    // a video with sound is preferred over joining one that isn't better
    const both = { format_id: "both-720", url: "https://cdn/720.mp4", protocol: "https", ext: "mp4", height: 720 };
    const video = { format_id: "video-720", url: "https://cdn/v720.mp4", protocol: "https", ext: "mp4", acodec: "none", height: 720 };
    const audio = { format_id: "audio", url: "https://cdn/a.m4a", protocol: "https", ext: "m4a", vcodec: "none" };
    assert.equal(pickFormats([both, video, audio]).video.format_id, "both-720");
    assert.equal(pickFormats([both, video, audio]).audio, undefined);

    // direct files over hls of the same size
    const hls = { ...both, format_id: "hls-720", url: "https://cdn/720.m3u8", protocol: "m3u8_native" };
    assert.equal(pickFormats([hls, both]).video.format_id, "both-720");

    // video and audio are only joined when they're the same kind (direct or hls)
    const directAudioOnly = [...ted.filter(f => f.format_id !== "hls-audio"), audio];
    assert.equal(pickFormats(directAudioOnly).video.format_id, "h264-1200k");
});

test("files that play everywhere are preferred", () => {
    // like archive.org: a bigger avi, a smaller mp4
    const formats = [
        { format_id: "ogv", url: "u1", protocol: "https", ext: "ogv", height: 300 },
        { format_id: "mp4", url: "u2", protocol: "https", ext: "mp4", height: 360 },
        { format_id: "avi", url: "u3", protocol: "https", ext: "avi", height: 720 },
    ];
    assert.equal(pickFormats(formats).video.format_id, "mp4");
    assert.equal(pickFormats(formats.filter(f => f.ext !== "mp4")).video.format_id, "avi");
});

test("songs and pictures", () => {
    const song = { url: "https://cdn/s.mp3", protocol: "https", ext: "mp3", vcodec: "none", acodec: "mp3", abr: 128 };
    assert.deepEqual(pickFormats([song]), { audio: song });

    // like imgur: a gif and the same as mp4
    const gif = { url: "https://cdn/a.gif", protocol: "https", ext: "gif", acodec: "none", width: 400, height: 300 };
    const mp4 = { url: "https://cdn/a.mp4", protocol: "https", ext: "mp4" };
    assert.equal(pickFormats([gif, mp4]).video, mp4);

    const small = { url: "https://cdn/s.jpg", protocol: "https", ext: "jpg", width: 100, height: 100 };
    const big = { url: "https://cdn/b.jpg", protocol: "https", ext: "jpg", width: 1000, height: 800 };
    assert.deepEqual(pickFormats([small, big]), { image: big });
    assert.deepEqual(pickFormats([]), {});
});

test("cookies only go to their own site", () => {
    const cookies = "ia-csrf=abc; Domain=.archive.org; Path=/; Secure; Expires=1798383096; "
        + "id=7; Domain=.archive.org; Path=/; other=1; Domain=.example.com; Path=/";

    assert.deepEqual(parseCookies(cookies), [
        { name: "ia-csrf", value: "abc", domain: "archive.org" },
        { name: "id", value: "7", domain: "archive.org" },
        { name: "other", value: "1", domain: "example.com" },
    ]);

    const format = {
        cookies,
        http_headers: {
            "User-Agent": "Mozilla/5.0", "Referer": "https://archive.org/", "Accept": "text/html",
            "Host": "evil", "Range": "bytes=0-1",
        },
    };
    assert.deepEqual(headersFor(format, "https://ia800.us.archive.org/file.mp4"), {
        "user-agent": "Mozilla/5.0",
        "referer": "https://archive.org/",
        "cookie": "ia-csrf=abc; id=7",
    });
    assert.equal(headersFor(format, "https://cdn.other.net/file.mp4").cookie, undefined);
    assert.equal(headersFor(format, "https://notarchive.org/file.mp4").cookie, undefined);
});

// a stand-in for the yt-dlp container, answering with the given result
const fakeYtdlp = async (t, answer) => {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", chunk => body += chunk);
        req.on("end", () => {
            requests.push(JSON.parse(body));
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(typeof answer === "function" ? answer(JSON.parse(body)) : answer));
        });
    }).listen(0, "127.0.0.1");
    await new Promise(r => server.on("listening", r));

    const previous = env.ytdlpURL;
    env.ytdlpURL = `http://127.0.0.1:${server.address().port}/`;
    t.after(() => {
        env.ytdlpURL = previous;
        server.close();
    });

    return requests;
}

// files on public addresses (so no dns is needed), checked by the api
const fakeFiles = (t, files) => {
    const realFetch = globalThis.fetch;
    t.after(() => globalThis.fetch = realFetch);

    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, headers: init.headers });
        const file = files[url];
        if (!file) return new Response("", { status: 404 });
        if (file.redirect) return new Response("", { status: 302, headers: { location: file.redirect } });
        return new Response(file.body ?? "x", { status: file.status ?? 206 });
    }
    return requests;
}

const CDN = "https://93.184.216.34";

test("a video from yt-dlp, with its headers", async (t) => {
    const asked = await fakeYtdlp(t, {
        ok: true,
        info: {
            id: "abc", title: "a talk", uploader: "someone", extractor_key: "TedTalk", duration: 600, type: "video",
            formats: [
                { url: `${CDN}/v.m3u8`, protocol: "m3u8_native", ext: "mp4", vcodec: "avc1", acodec: "none", height: 1080,
                  http_headers: { "User-Agent": "UA", "Referer": "https://ted.example/" } },
                { url: `${CDN}/a.m3u8`, protocol: "m3u8_native", ext: "mp4", vcodec: "none" },
            ],
        },
    });
    const files = fakeFiles(t, {
        [`${CDN}/v.m3u8`]: { status: 200, body: "#EXTM3U\n#EXT-X-ENDLIST\n" },
        [`${CDN}/a.m3u8`]: { status: 200, body: "#EXTM3U\n#EXT-X-ENDLIST\n" },
    });

    const r = await ytdlp({ url: "https://ted.example/talks/1", quality: "max" });
    assert.deepEqual(asked, [{ url: "https://ted.example/talks/1" }]);

    assert.deepEqual(r.urls, [`${CDN}/v.m3u8`, `${CDN}/a.m3u8`]);
    assert.equal(r.isHLS, true);
    assert.deepEqual(r.headers, { "user-agent": "UA", "referer": "https://ted.example/" });
    assert.equal(r.filenameAttributes.service, "tedtalk");
    assert.equal(r.filenameAttributes.qualityLabel, "1080p");
    assert.deepEqual(r.fileMetadata, { title: "a talk", artist: "someone" });
    // the playlists were checked with the same headers
    assert.equal(files[0].headers.referer, "https://ted.example/");

    // joined into one file by the server
    const body = matchAction({ r, host: "generic", filenameStyle: "basic", localProcessing: "disabled" }).body;
    assert.equal(body.status, "tunnel");
    assert.equal(body.filename, "a talk - someone (1080p).mp4");
});

test("redirects of files are followed and checked", async (t) => {
    await fakeYtdlp(t, {
        ok: true,
        info: { id: "1", title: "t", type: "video", formats: [{ url: `${CDN}/file`, protocol: "https", ext: "mp4" }] },
    });
    fakeFiles(t, {
        [`${CDN}/file`]: { redirect: `${CDN}/real.mp4` },
        [`${CDN}/real.mp4`]: { status: 206 },
    });

    const r = await ytdlp({ url: "https://site.example/v/1", quality: "max" });
    // the tunnel gets the final address, it doesn't follow redirects itself
    assert.equal(r.urls, `${CDN}/real.mp4`);
    assert.equal(r.proxy, true);

    const body = matchAction({ r, host: "generic", filenameStyle: "basic", localProcessing: "disabled" }).body;
    assert.equal(body.status, "tunnel");
});

test("files on internal addresses aren't used", async (t) => {
    await fakeYtdlp(t, {
        ok: true,
        info: { id: "1", type: "video", formats: [{ url: "http://127.0.0.1/secret.mp4", protocol: "http", ext: "mp4" }] },
    });
    const files = fakeFiles(t, {});

    assert.deepEqual(await ytdlp({ url: "https://site.example/v/1" }), { error: "fetch.fail" });
    // not even requested
    assert.equal(files.length, 0);
});

test("a redirect to an internal address isn't followed", async (t) => {
    await fakeYtdlp(t, {
        ok: true,
        info: { id: "1", type: "video", formats: [{ url: `${CDN}/file`, protocol: "https", ext: "mp4" }] },
    });
    const files = fakeFiles(t, {
        [`${CDN}/file`]: { redirect: "http://169.254.169.254/latest/meta-data" },
    });

    assert.deepEqual(await ytdlp({ url: "https://site.example/v/1" }), { error: "fetch.fail" });
    assert.deepEqual(files.map(f => f.url), [`${CDN}/file`]);
});

test("yt-dlp's answers", async (t) => {
    const answers = {
        "https://a.example/unsupported": { ok: false, error: "unsupported" },
        "https://a.example/unsafe": { ok: false, error: "unsafe" },
        "https://a.example/busy": { ok: false, error: "busy" },
        "https://a.example/private": { ok: false, error: "content.video.private" },
        "https://a.example/odd": { ok: false, error: "something else" },
        "https://a.example/live": { ok: true, info: { type: "video", is_live: true, formats: [] } },
        "https://a.example/long": { ok: true, info: { type: "video", duration: env.durationLimit + 1, formats: [] } },
        "https://a.example/empty": { ok: true, info: { type: "video", formats: [] } },
    };
    await fakeYtdlp(t, ({ url }) => answers[url]);

    const expected = {
        "https://a.example/unsupported": { unsupported: true },
        "https://a.example/unsafe": { error: "link.invalid" },
        "https://a.example/busy": { error: "fetch.rate" },
        "https://a.example/private": { error: "content.video.private" },
        "https://a.example/odd": { error: "fetch.fail" },
        "https://a.example/live": { error: "content.video.live" },
        "https://a.example/long": { error: "content.too_long" },
        "https://a.example/empty": { error: "fetch.empty" },
    };

    for (const [ url, result ] of Object.entries(expected)) {
        assert.deepEqual(await ytdlp({ url }), result, url);
    }
});

test("when yt-dlp can't be reached, the link is left to the generic extractor", async (t) => {
    const previous = env.ytdlpURL;
    // nothing listens there
    env.ytdlpURL = "http://127.0.0.1:9/";
    t.after(() => env.ytdlpURL = previous);

    assert.deepEqual(await ytdlp({ url: "https://a.example/v" }), { unsupported: true, unreachable: true });

    // without the generic extractor, it's an error of fetching, not an invalid link
    const url = "https://a.example/v";
    const response = await match({
        host: "generic",
        patternMatch: { url },
        params: { url: new URL(url), videoQuality: "max", downloadMode: "auto", filenameStyle: "basic" },
    });
    assert.equal(response.body.error.code, "error.api.fetch.fail");
});

test("albums with videos and pictures become a picker", async (t) => {
    await fakeYtdlp(t, {
        ok: true,
        info: {
            type: "playlist", id: "album", extractor_key: "ImgurAlbum",
            entries: [
                { id: "1", formats: [{ url: `${CDN}/1.mp4`, protocol: "https", ext: "mp4" }] },
                { id: "2", formats: [{ url: `${CDN}/2.jpg`, protocol: "https", ext: "jpg", width: 10, height: 10 }] },
            ],
        },
    });
    fakeFiles(t, { [`${CDN}/1.mp4`]: {}, [`${CDN}/2.jpg`]: {} });

    const r = await ytdlp({ url: "https://imgur.example/a/album" });
    assert.deepEqual(r.picker.map(i => i.type), ["video", "photo"]);
    assert.match(r.picker[0].url, /^http:\/\/localhost:9000\/tunnel\?id=/);

    const body = matchAction({ r, host: "generic", filenameStyle: "basic", localProcessing: "disabled" }).body;
    assert.equal(body.status, "picker");
    assert.equal(body.picker.length, 2);
});

test("other sites go to yt-dlp when it's set up", () => {
    const url = "https://random.example/videos/42";
    assert.deepEqual(extract(normalizeURL(url)), { error: "link.invalid" });

    const previous = env.ytdlpURL;
    env.ytdlpURL = "http://ytdlp:4417/";
    try {
        assert.equal(extract(normalizeURL(url)).host, "generic");
    } finally {
        env.ytdlpURL = previous;
    }
});

test("sites yt-dlp doesn't know are an invalid link without the generic extractor", async (t) => {
    await fakeYtdlp(t, { ok: false, error: "unsupported" });

    const url = "https://random.example/page";
    const response = await match({
        host: "generic",
        patternMatch: { url },
        params: { url: new URL(url), videoQuality: "max", downloadMode: "auto", filenameStyle: "basic" },
    });

    assert.equal(response.body.status, "error");
    assert.equal(response.body.error.code, "error.api.link.invalid");
});
