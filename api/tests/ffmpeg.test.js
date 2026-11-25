import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Writable } from "node:stream";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

import ffmpegPath from "ffmpeg-static";
import ffmpeg from "../src/stream/ffmpeg.js";

const collect = () => {
    const chunks = [];
    const res = new Writable({
        write(chunk, _, cb) {
            res.headersSent = true;
            chunks.push(chunk);
            cb();
        },
    });

    Object.assign(res, {
        headersSent: false,
        setHeader() {},
        status() { return this; },
        sendStatus(code) { this.failedWith = code; return this; },
    });

    // like express: ending a response sends its headers (status 200 by default)
    const end = res.end.bind(res);
    res.end = (...args) => {
        res.headersSent = true;
        return end(...args);
    };

    const done = new Promise(r => res.on("finish", () => r(Buffer.concat(chunks))));
    return { res, done };
};

test("audio converts to m4a through a pipe", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "fetchr-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const source = join(dir, "source.m4a");
    const generated = spawnSync(ffmpegPath, [
        "-loglevel", "error", "-f", "lavfi", "-i", "sine=duration=1",
        "-c:a", "aac", "-f", "ipod", source,
    ]);
    assert.equal(generated.status, 0, "failed to generate test audio");

    const server = http.createServer((_, res) => {
        res.setHeader("content-type", "audio/mp4");
        res.end(readFileSync(source));
    }).listen(0, "127.0.0.1");
    t.after(() => server.close());
    await new Promise(r => server.on("listening", r));

    const { res, done } = collect();
    await ffmpeg.convertAudio({
        urls: `http://127.0.0.1:${server.address().port}/source.m4a`,
        filename: "audio.m4a",
        audioFormat: "m4a",
        audioCopy: true,
        audioBitrate: "128",
        metadata: false,
    }, res);

    const output = await done;
    assert.equal(res.failedWith, undefined);
    assert.ok(output.length > 1000, `output is too small (${output.length} bytes)`);
    assert.equal(output.subarray(4, 8).toString(), "ftyp");
});

test("audio of a video without sound is an error, not an empty file", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "fetchr-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const source = join(dir, "silent.mp4");
    const generated = spawnSync(ffmpegPath, [
        "-loglevel", "error", "-f", "lavfi", "-i", "color=duration=1:size=64x64",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", source,
    ]);
    assert.equal(generated.status, 0, "failed to generate test video");

    const server = http.createServer((_, res) => {
        res.setHeader("content-type", "video/mp4");
        res.end(readFileSync(source));
    }).listen(0, "127.0.0.1");
    t.after(() => server.close());
    await new Promise(r => server.on("listening", r));

    const { res, done } = collect();
    await ffmpeg.convertAudio({
        urls: `http://127.0.0.1:${server.address().port}/silent.mp4`,
        filename: "audio.mp3",
        audioFormat: "mp3",
        audioCopy: false,
        audioBitrate: "128",
        metadata: false,
    }, res);

    const output = await done;
    assert.equal(res.failedWith, 500);
    assert.equal(output.length, 0);
});
