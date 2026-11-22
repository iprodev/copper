import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";

import { Bot, extractLink } from "../src/bot.js";
import { Telegram } from "../src/telegram.js";
import { FetchrClient } from "../src/fetchr.js";
import { loadConfig } from "../src/config.js";
import { messages, errorText } from "../src/messages.js";
import { mediaKind, filenameFrom } from "../src/download.js";

const listen = (server) => new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

const readBody = (req) => new Promise(resolve => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
});

// fake telegram bot api, remembers every call
const calls = [];
const telegramServer = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const method = req.url.split("/").pop();
    const type = req.headers["content-type"] || "";

    let params;
    if (type.startsWith("multipart/form-data")) {
        const form = await new Response(body, { headers: { "content-type": type } }).formData();
        params = {};
        for (const [key, value] of form) {
            params[key] = typeof value === "string"
                ? value
                : { filename: value.name, type: value.type, content: Buffer.from(await value.arrayBuffer()).toString() };
        }
    } else {
        params = JSON.parse(body.toString() || "{}");
    }

    calls.push({ method, params, token: req.url.split("/")[1] });

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, result: { message_id: 100 + calls.length } }));
});

// fake fetchr api: answers depend on the requested url
let publicUrl;
const fetchrServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");

    if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ fetchr: { url: publicUrl, version: "1.0" } }));
    }

    if (req.method === "GET" && url.pathname === "/tunnel") {
        const id = url.searchParams.get("id");
        const files = {
            video: ["video/mp4", 'attachment; filename="clip.mp4"', "fake video bytes"],
            photo1: ["image/jpeg", undefined, "photo one"],
            photo2: ["image/jpeg", undefined, "photo two"],
            big: ["video/mp4", 'attachment; filename="big.mp4"', "x".repeat(5000)],
            song: ["audio/mpeg", "attachment; filename*=UTF-8''%D8%A2%D9%87%D9%86%DA%AF.mp3", "audio bytes"],
        };
        const [type, disposition, content] = files[id];
        res.setHeader("content-type", type);
        if (disposition) res.setHeader("content-disposition", disposition);
        return res.end(content);
    }

    const request = JSON.parse((await readBody(req)).toString());
    const tunnel = (id) => `${publicUrl}tunnel?id=${id}`;

    let response;
    switch (request.url) {
        case "https://video.example/1":
            assert.equal(request.alwaysProxy, true);
            assert.equal(req.headers.authorization, "Api-Key test-key");
            response = { status: "tunnel", url: tunnel("video"), filename: "clip.mp4" };
            break;
        case "https://photos.example/1":
            response = { status: "picker", picker: [
                { type: "photo", url: tunnel("photo1") },
                { type: "photo", url: tunnel("photo2") },
            ]};
            break;
        case "https://big.example/1":
            response = { status: "tunnel", url: tunnel("big"), filename: "big.mp4" };
            break;
        case "https://music.example/1":
            assert.equal(request.downloadMode, "audio");
            response = { status: "tunnel", url: tunnel("song") };
            break;
        default:
            response = { status: "error", error: { code: "error.api.fetch.empty" } };
    }

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
});

let bot;
let config;

before(async () => {
    const telegramUrl = await listen(telegramServer);
    const fetchrUrl = await listen(fetchrServer);
    // the api says its public url is elsewhere, tunnels must be fetched internally
    publicUrl = "https://api.public.example/";

    config = loadConfig({
        BOT_TOKEN: "123:secret",
        TELEGRAM_API_URL: telegramUrl,
        FETCHR_API_URL: fetchrUrl,
        FETCHR_API_KEY: "test-key",
        MAX_FILE_SIZE_MB: "1",
        USER_RATE_LIMIT: "3",
    });
    config.maxFileSize = 1000;

    const telegram = new Telegram({ token: config.token, apiUrl: config.telegramApi });
    const fetchr = new FetchrClient({ apiUrl: config.fetchrApi, apiKey: config.fetchrApiKey });
    await fetchr.init();

    bot = new Bot({ config, telegram, fetchr });
});

after(() => {
    telegramServer.close();
    fetchrServer.close();
});

beforeEach(() => {
    calls.length = 0;
});

let nextUser = 1;
const message = (text, { language = "en", user = nextUser++, chatType = "private" } = {}) => ({
    update_id: 1,
    message: {
        message_id: 7,
        text,
        chat: { id: user, type: chatType },
        from: { id: user, language_code: language },
    },
});

const sent = () => calls.filter(c => c.method.startsWith("send") && c.method !== "sendMessage" && c.method !== "sendChatAction");
const lastText = () => calls.filter(c => ["sendMessage", "editMessageText"].includes(c.method)).at(-1)?.params.text;

test("a link becomes a file in the chat", async () => {
    await bot.handleUpdate(message("look https://video.example/1 !"));

    assert.ok(calls.every(c => c.token === "bot123:secret"));

    const [ upload ] = sent();
    assert.equal(upload.method, "sendVideo");
    assert.equal(upload.params.video.filename, "clip.mp4");
    assert.equal(upload.params.video.content, "fake video bytes");
    assert.equal(upload.params.supports_streaming, "true");

    // the status message is removed once the file is sent
    assert.equal(calls.at(-1).method, "deleteMessage");

    // temporary files are cleaned up
    const leftovers = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith("fetchr-bot-"));
    assert.deepEqual(leftovers, []);
});

test("items of a picker are sent as one album", async () => {
    await bot.handleUpdate(message("https://photos.example/1"));

    const [ album, ...rest ] = sent();
    assert.equal(rest.length, 0);
    assert.equal(album.method, "sendMediaGroup");
    assert.deepEqual(JSON.parse(album.params.media), [
        { type: "photo", media: "attach://file0" },
        { type: "photo", media: "attach://file1" },
    ]);
    assert.deepEqual([album.params.file0.content, album.params.file1.content], ["photo one", "photo two"]);
    assert.equal(calls.at(-1).method, "deleteMessage");
});

test("/audio asks for the audio, unicode filenames are kept", async () => {
    await bot.handleUpdate(message("/audio https://music.example/1"));

    const [ upload ] = sent();
    assert.equal(upload.method, "sendAudio");
    assert.equal(upload.params.audio.filename, "آهنگ.mp3");
});

test("files over the limit are refused, with a message in the user's language", async () => {
    await bot.handleUpdate(message("https://big.example/1", { language: "fa" }));

    assert.equal(sent().length, 0);
    assert.match(lastText(), /خیلی بزرگ است/);
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith("fetchr-bot-")), []);
});

test("api errors are explained", async () => {
    await bot.handleUpdate(message("https://nothing.example/1"));
    assert.equal(lastText(), messages("en").errors.empty);

    await bot.handleUpdate(message("https://nothing.example/1", { language: "fa-IR" }));
    assert.equal(lastText(), messages("fa").errors.empty);
});

test("messages without links, /start and group chats", async () => {
    await bot.handleUpdate(message("/start"));
    assert.equal(lastText(), messages("en").help);

    await bot.handleUpdate(message("hello"));
    assert.equal(lastText(), messages("en").noLink);

    calls.length = 0;
    await bot.handleUpdate(message("https://video.example/1", { chatType: "group" }));
    assert.equal(calls.length, 0);
});

test("users are rate limited", async () => {
    const user = nextUser++;
    for (let i = 0; i < 3; i++) {
        await bot.handleUpdate(message("https://nothing.example/1", { user }));
    }
    await bot.handleUpdate(message("https://nothing.example/1", { user }));
    assert.equal(lastText(), messages("en").rateLimited);
});

test("only allowed users can use the bot, when a list is set", async () => {
    config.allowedUsers = new Set([42]);
    try {
        await bot.handleUpdate(message("https://video.example/1", { user: 41 }));
        assert.equal(lastText(), messages("en").notAllowed);
        assert.equal(sent().length, 0);
    } finally {
        config.allowedUsers = null;
    }
});

test("links are found in entities and text", () => {
    assert.equal(extractLink({ text: "see https://a.example/x?y=1." }), "https://a.example/x?y=1.");
    assert.equal(extractLink({
        text: "click here",
        entities: [{ type: "text_link", offset: 0, length: 10, url: "https://b.example/" }],
    }), "https://b.example/");
    assert.equal(extractLink({
        text: "🎬 youtu.be/abc",
        entities: [{ type: "url", offset: 3, length: 12 }],
    }), "https://youtu.be/abc");
    assert.equal(extractLink({ text: "no links here" }), undefined);
});

test("helpers", () => {
    assert.equal(mediaKind("a.mp4"), "video");
    assert.equal(mediaKind("a.GIF"), "animation");
    assert.equal(mediaKind("a.opus"), "audio");
    assert.equal(mediaKind("file", "image/png"), "photo");
    assert.equal(mediaKind("file.zip", "application/zip"), "document");

    assert.equal(filenameFrom('attachment; filename="a b.mp4"'), "a b.mp4");
    assert.equal(filenameFrom("attachment; filename*=UTF-8''%F0%9F%8E%B5.mp3"), "🎵.mp3");

    const fa = messages("fa");
    assert.equal(errorText(fa, "error.api.content.too_long", { limit: 180 }), fa.errors.tooLong(180));
    assert.equal(errorText(fa, "error.api.link.unsupported"), fa.errors.unsupported);
    assert.equal(errorText(fa, "error.api.auth.key.invalid"), fa.errors.config);
    assert.match(errorText(fa, "error.api.something.new"), /something\.new/);

    assert.throws(() => loadConfig({}), /BOT_TOKEN/);
    assert.throws(() => loadConfig({ BOT_TOKEN: "x", VIDEO_QUALITY: "999" }), /VIDEO_QUALITY/);
    assert.equal(loadConfig({ BOT_TOKEN: "x" }).maxFileSize, 50 * 1024 * 1024);
    assert.equal(loadConfig({ BOT_TOKEN: "x", TELEGRAM_API_URL: "http://bot-api:8081" }).maxFileSize, 2000 * 1024 * 1024);
});
