import { test } from "node:test";
import assert from "node:assert/strict";
import tls from "node:tls";

import createFilename, { sanitizeString } from "../src/processing/create-filename.js";
import { splitFilenameExtension } from "../src/misc/utils.js";
import { randomizeCiphers } from "../src/misc/randomize-ciphers.js";
import MemoryStore from "../src/store/memory-store.js";

test("filenames are sanitized for windows", () => {
    assert.equal(sanitizeString('a<b>c:d"e/f\\g|h?i*j\u0000\u001f'), "a＜b＞c：d＂e／f＼g｜h？i＊j");
});

test("filename styles", () => {
    const f = {
        service: "youtube",
        id: "abc",
        title: "my video",
        author: "someone",
        resolution: "1920x1080",
        qualityLabel: "1080p",
        youtubeFormat: "h264",
        extension: "mp4",
    };

    assert.equal(createFilename(f, "classic"), "youtube_abc_1920x1080_h264.mp4");
    assert.equal(createFilename(f, "basic"), "my video - someone (1080p, h264).mp4");
    assert.equal(createFilename(f, "pretty"), "my video - someone (1080p, h264, youtube).mp4");
    assert.equal(createFilename(f, "nerdy"), "my video - someone (1080p, h264, youtube, abc).mp4");
    assert.equal(createFilename(f, "basic", true), "my video - someone");
    assert.equal(createFilename(f, "classic", false, true), "youtube_abc_1920x1080_h264_mute.mp4");
});

test("splitFilenameExtension", () => {
    assert.deepEqual(splitFilenameExtension("a.b.mp4"), ["a.b", "mp4"]);
    assert.deepEqual(splitFilenameExtension("noext"), ["noext", ""]);
});

test("cipher randomization keeps the same set of ciphers", () => {
    const original = tls.DEFAULT_CIPHERS.split(":").sort();
    randomizeCiphers();
    assert.deepEqual(tls.DEFAULT_CIPHERS.split(":").sort(), original);
});

test("memory store keeps values until they expire", async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"] });

    const store = new MemoryStore("unit-test");
    await store.set("a", "1", 5);
    await store.set("b", "2");

    assert.equal(await store.get("a"), "1");
    assert.equal(await store.get("missing"), null);

    t.mock.timers.tick(6000);
    assert.equal(await store.get("a"), null);
    assert.equal(await store.get("b"), "2");
});
