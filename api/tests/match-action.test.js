import { test } from "node:test";
import assert from "node:assert/strict";

import matchAction from "../src/processing/match-action.js";

const base = {
    audioFormat: "mp3",
    isAudioOnly: false,
    isAudioMuted: false,
    disableMetadata: false,
    filenameStyle: "basic",
    convertGif: true,
    audioBitrate: "128",
    alwaysProxy: false,
    localProcessing: "disabled",
};

const run = (r, host, params = {}) => matchAction({ r, host, ...base, ...params }).body;

test("direct links are redirected", () => {
    const body = run({ urls: "https://cdn.example/a.mp4", filename: "a.mp4" }, "instagram");
    assert.equal(body.status, "redirect");
    assert.equal(body.url, "https://cdn.example/a.mp4");
});

test("alwaysProxy turns a redirect into a tunnel", () => {
    const body = run({ urls: "https://cdn.example/a.mp4", filename: "a.mp4" }, "instagram", { alwaysProxy: true });
    assert.equal(body.status, "tunnel");
    assert.match(body.url, /^http:\/\/localhost:9000\/tunnel\?id=/);
});

test("audio with best format and no service preference copies to m4a", () => {
    const body = run(
        { urls: "https://cdn.example/a.mp4", audioFilename: "audio" },
        "twitter",
        { isAudioOnly: true, audioFormat: "best", localProcessing: "forced" }
    );

    assert.equal(body.status, "local-processing");
    assert.equal(body.type, "audio");
    assert.equal(body.output.filename, "audio.m4a");
    assert.deepEqual(body.audio, { copy: true, format: "m4a", bitrate: "128", cover: undefined, cropCover: undefined });
});

test("audio is refused for services without audio support", () => {
    const body = run({ urls: "https://cdn.example/a.mp4", filename: "a.mp4" }, "vk", { isAudioOnly: true });
    assert.equal(body.status, "error");
    assert.equal(body.error.code, "error.api.service.audio_not_supported");
});

test("local processing is used only when requested", () => {
    const r = { urls: ["https://cdn.example/v.mp4", "https://cdn.example/a.mp4"], filename: "v.mp4" };

    assert.equal(run(r, "bilibili").status, "tunnel");
    assert.equal(run(r, "bilibili", { localProcessing: "preferred" }).status, "local-processing");
    assert.equal(run(r, "bilibili", { localProcessing: "preferred" }).tunnel.length, 2);
});

test("clients that can't encode only get merging and remuxing", () => {
    const merge = { urls: ["https://cdn.example/v.mp4", "https://cdn.example/a.mp4"], filename: "v.mp4" };
    const audio = { urls: "https://cdn.example/v.mp4", audioFilename: "a" };
    const preferred = { localProcessing: "preferred", localEncoding: false };

    // merging is light, it's still done by the client
    assert.equal(run(merge, "bilibili", preferred).status, "local-processing");

    // converting audio is done by the server
    assert.equal(run(audio, "twitter", { ...preferred, isAudioOnly: true }).status, "tunnel");
    assert.equal(run(audio, "twitter", { localProcessing: "preferred", isAudioOnly: true }).status, "local-processing");

    // copying the audio as it is needs no encoding
    const copy = run(audio, "twitter", { ...preferred, isAudioOnly: true, audioFormat: "best" });
    assert.equal(copy.status, "local-processing");
    assert.equal(copy.audio.copy, true);

    // forced local processing stays forced
    assert.equal(run(audio, "twitter", { ...preferred, localProcessing: "forced", isAudioOnly: true }).status, "local-processing");
});

test("picker responses keep their items", () => {
    const picker = [{ type: "photo", url: "https://cdn.example/1.jpg" }];
    const body = run({ picker }, "instagram");

    assert.equal(body.status, "picker");
    assert.deepEqual(body.picker, picker);
});
