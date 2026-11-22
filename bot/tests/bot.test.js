import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";

import { Bot, extractLink, serviceOf } from "../src/bot.js";
import { Telegram } from "../src/telegram.js";
import { FetchrClient } from "../src/fetchr.js";
import { Store } from "../src/store.js";
import { loadConfig } from "../src/config.js";
import { messages, errorText, format } from "../src/messages.js";
import { mediaKind, filenameFrom } from "../src/download.js";

const fa = messages("fa");
const en = messages("en");
const ADMIN = 1000;
const BOT_ID = 123;

const listen = (server) => new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

const readBody = (req) => new Promise(resolve => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
});

// ---- fake telegram bot api, remembers every call
const calls = [];
const memberships = new Map(); // `${channel}:${user}` -> status
const blockedUsers = new Set(); // users that blocked the bot
let messageId = 500;

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

    calls.push({ method, params });

    const ok = (result) => res.end(JSON.stringify({ ok: true, result }));
    const fail = (error_code, description) => res.end(JSON.stringify({ ok: false, error_code, description }));
    res.setHeader("content-type", "application/json");

    switch (method) {
        case "getChatMember": {
            const status = params.user_id === BOT_ID
                ? (params.chat_id === -1002 ? "member" : "administrator")
                : memberships.get(`${params.chat_id}:${params.user_id}`) ?? "left";
            return ok({ status });
        }
        case "getChat":
            if (params.chat_id === "@chan" || params.chat_id === -1001) {
                return ok({ id: -1001, type: "channel", title: "my channel", username: "chan" });
            }
            if (params.chat_id === "@noadmin") {
                return ok({ id: -1002, type: "channel", title: "other", username: "noadmin" });
            }
            return fail(400, "Bad Request: chat not found");
        case "copyMessage":
            if (blockedUsers.has(params.chat_id)) return fail(403, "Forbidden: bot was blocked by the user");
            return ok({ message_id: ++messageId });
        default:
            return ok({ message_id: ++messageId });
    }
});

// ---- fake fetchr api: answers depend on the requested url
let publicUrl;
const requests = [];
const fetchrServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");

    if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ fetchr: { url: publicUrl, version: "1.0" } }));
    }

    if (req.method === "GET" && url.pathname === "/tunnel") {
        const files = {
            video: ["video/mp4", 'attachment; filename="clip.mp4"', "fake video bytes"],
            photo1: ["image/jpeg", undefined, "photo one"],
            photo2: ["image/jpeg", undefined, "photo two"],
            big: ["video/mp4", 'attachment; filename="big.mp4"', "x".repeat(5000)],
            song: ["audio/mpeg", "attachment; filename*=UTF-8''%D8%A2%D9%87%D9%86%DA%AF.mp3", "audio bytes"],
        };
        const [type, disposition, content] = files[url.searchParams.get("id")];
        res.setHeader("content-type", type);
        if (disposition) res.setHeader("content-disposition", disposition);
        return res.end(content);
    }

    const request = JSON.parse((await readBody(req)).toString());
    requests.push(request);
    const tunnel = (id) => `${publicUrl}tunnel?id=${id}`;

    let response;
    if (request.downloadMode === "audio") {
        response = { status: "tunnel", url: tunnel("song") };
    } else if (request.url.startsWith("https://video.example/")) {
        assert.equal(request.alwaysProxy, true);
        assert.equal(req.headers.authorization, "Api-Key test-key");
        response = { status: "tunnel", url: tunnel("video"), filename: "clip.mp4" };
    } else if (request.url === "https://photos.example/1") {
        response = { status: "picker", picker: [
            { type: "photo", url: tunnel("photo1") },
            { type: "photo", url: tunnel("photo2") },
        ]};
    } else if (request.url === "https://big.example/1") {
        response = { status: "tunnel", url: tunnel("big"), filename: "big.mp4" };
    } else {
        response = { status: "error", error: { code: "error.api.fetch.empty" } };
    }

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
});

let bot;
let config;
let store;

before(async () => {
    const telegramUrl = await listen(telegramServer);
    const fetchrUrl = await listen(fetchrServer);
    // the api says its public url is elsewhere, tunnels must be fetched internally
    publicUrl = "https://api.public.example/";

    config = loadConfig({
        BOT_TOKEN: `${BOT_ID}:secret`,
        TELEGRAM_API_URL: telegramUrl,
        FETCHR_API_URL: fetchrUrl,
        FETCHR_API_KEY: "test-key",
        USER_RATE_LIMIT: "3",
        ADMIN_IDS: String(ADMIN),
    });
    config.maxFileSize = 1000;

    const telegram = new Telegram({ token: config.token, apiUrl: config.telegramApi });
    const fetchr = new FetchrClient({ apiUrl: config.fetchrApi, apiKey: config.fetchrApiKey });
    await fetchr.init();

    store = new Store(":memory:");
    bot = new Bot({ config, telegram, fetchr, store });
});

after(() => {
    telegramServer.close();
    fetchrServer.close();
    store.close();
});

beforeEach(() => {
    calls.length = 0;
    requests.length = 0;
});

// ---- helpers to talk to the bot
let nextUser = 1;
const newUser = (language = "en", quality = "ask") => {
    const id = nextUser++;
    store.touchUser(id);
    store.setLanguage(id, language);
    store.setQuality(id, quality);
    return id;
};

let updateMessageId = 1;
const send = (user, text, extra = {}) => bot.handleUpdate({
    update_id: 1,
    message: {
        message_id: updateMessageId++,
        text,
        chat: { id: user, type: "private" },
        from: { id: user, language_code: "en" },
        ...extra,
    },
});

const press = (user, data, message_id = 900) => bot.handleUpdate({
    update_id: 1,
    callback_query: {
        id: "cb",
        data,
        from: { id: user, language_code: "en" },
        message: { message_id, chat: { id: user, type: "private" } },
    },
});

const texts = () => calls
    .filter(c => ["sendMessage", "editMessageText"].includes(c.method))
    .map(c => c.params.text);
const lastText = () => texts().at(-1);
const lastMarkup = () => calls.filter(c => c.params.reply_markup).at(-1)?.params.reply_markup;
const buttons = () => (lastMarkup()?.inline_keyboard ?? []).flat();
const uploads = () => calls.filter(c => /^send(Video|Audio|Photo|Animation|Document|MediaGroup)$/.test(c.method));

// pick a quality on the keyboard the bot just sent
const pickQuality = async (user, label) => {
    const choice = buttons().find(b => b.text.includes(label));
    assert.ok(choice, `no ${label} button`);
    await press(user, choice.callback_data);
};

// ---- users

test("new users choose a language, then get the welcome message", async () => {
    const user = nextUser++;
    await send(user, "/start");

    assert.equal(lastText(), fa.chooseLanguage);
    assert.deepEqual(buttons().map(b => b.callback_data), ["lang:fa", "lang:en"]);

    await press(user, "lang:fa");
    assert.equal(store.getUser(user).language, "fa");
    assert.ok(texts().includes(fa.languageSet));
    assert.equal(lastText(), fa.welcome);
    // the welcome message comes with the main keyboard
    assert.deepEqual(lastMarkup().keyboard.flat().map(b => b.text), [fa.buttons.help, fa.buttons.settings, fa.buttons.language]);

    // keyboard buttons work in both languages
    calls.length = 0;
    await send(user, fa.buttons.help);
    assert.equal(lastText(), format(fa.help, { limit: 0 }));
});

test("the quality is asked for, then the file is sent", async () => {
    const user = newUser();
    await send(user, "look https://video.example/1 !");

    assert.equal(lastText(), en.quality.choose);
    assert.equal(requests.length, 0);

    await pickQuality(user, "480p");
    assert.equal(requests[0].videoQuality, "480");
    assert.equal(requests[0].downloadMode, "auto");

    const [ upload ] = uploads();
    assert.equal(upload.method, "sendVideo");
    assert.equal(upload.params.video.filename, "clip.mp4");
    assert.equal(upload.params.video.content, "fake video bytes");
    assert.equal(upload.params.supports_streaming, "true");

    // the status message (the quality question) is removed once the file is sent
    assert.equal(calls.at(-1).method, "deleteMessage");
    assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith("fetchr-bot-")), []);

    assert.equal(store.stats().downloadsToday, 1);
    assert.deepEqual(store.stats().topServices, [{ service: "video", count: 1 }]);
});

test("audio only, from the keyboard and with /audio", async () => {
    const user = newUser("fa");
    await send(user, "https://video.example/2");
    await pickQuality(user, fa.quality.audio);

    assert.equal(requests[0].downloadMode, "audio");
    assert.equal(uploads()[0].method, "sendAudio");
    assert.equal(uploads()[0].params.audio.filename, "آهنگ.mp3");

    calls.length = 0;
    requests.length = 0;
    await send(user, "/audio https://video.example/3");
    assert.equal(requests[0].downloadMode, "audio");
});

test("canceled and expired quality questions", async () => {
    const user = newUser();
    await send(user, "https://video.example/4");
    await pickQuality(user, en.quality.cancel);
    assert.equal(lastText(), en.quality.canceled);
    assert.equal(requests.length, 0);

    // someone else's (or an old) question
    await send(user, "https://video.example/5");
    const choice = buttons().find(b => b.text.includes("720p")).callback_data;
    await press(newUser(), choice);
    assert.equal(lastText(), en.quality.expired);
    await press(user, "q:unknown:720");
    assert.equal(lastText(), en.quality.expired);
    assert.equal(requests.length, 0);
});

test("a default quality skips the question", async () => {
    const user = newUser();
    await send(user, "/settings");
    assert.ok(buttons().some(b => b.text === `✅ ${en.quality.ask}`));

    await press(user, "set:360");
    assert.equal(store.getUser(user).quality, "360");
    assert.ok(buttons().some(b => b.text === "✅ 360p"));

    calls.length = 0;
    await send(user, "https://video.example/6");
    assert.ok(!texts().includes(en.quality.choose));
    assert.equal(requests[0].videoQuality, "360");
    assert.equal(uploads().length, 1);

    // invalid values are ignored
    await press(user, "set:9999");
    assert.equal(store.getUser(user).quality, "360");
});

test("items of a picker are sent as one album", async () => {
    const user = newUser("en", "720");
    await send(user, "https://photos.example/1");

    const [ album, ...rest ] = uploads();
    assert.equal(rest.length, 0);
    assert.equal(album.method, "sendMediaGroup");
    assert.deepEqual(JSON.parse(album.params.media), [
        { type: "photo", media: "attach://file0" },
        { type: "photo", media: "attach://file1" },
    ]);
    assert.deepEqual([album.params.file0.content, album.params.file1.content], ["photo one", "photo two"]);
});

test("files over the limit are refused, errors are explained", async () => {
    const user = newUser("fa", "720");
    await send(user, "https://big.example/1");
    assert.equal(uploads().length, 0);
    assert.equal(lastText(), format(fa.tooBig, { limit: 0 }));

    await send(user, "https://nothing.example/1");
    assert.equal(lastText(), fa.errors.empty);
});

test("messages without links and group chats", async () => {
    const user = newUser();
    await send(user, "hello");
    assert.equal(lastText(), en.noLink);

    calls.length = 0;
    await bot.handleUpdate({ update_id: 1, message: {
        message_id: 1, text: "https://video.example/1",
        chat: { id: -5, type: "group" }, from: { id: user },
    }});
    assert.equal(calls.length, 0);
});

test("users are rate limited", async () => {
    const user = newUser("en", "720");
    for (let i = 0; i < 3; i++) {
        await send(user, "https://nothing.example/1");
    }
    await send(user, "https://nothing.example/1");
    assert.equal(lastText(), en.rateLimited);
});

// ---- required channels

test("required channels must be joined first", async () => {
    store.setSetting("channels", [{ id: -1001, title: "my channel", link: "https://t.me/chan" }]);
    try {
        const user = newUser("fa", "720");
        await send(user, "https://video.example/7");

        assert.equal(lastText(), fa.join.prompt);
        assert.deepEqual(lastMarkup().inline_keyboard, [
            [{ text: "📢 my channel", url: "https://t.me/chan" }],
            [{ text: fa.join.check, callback_data: "join:check" }],
        ]);
        assert.equal(requests.length, 0);

        // not joined yet
        await press(user, "join:check");
        const alert = calls.filter(c => c.method === "answerCallbackQuery").at(-1).params;
        assert.equal(alert.text, fa.join.notYet);
        assert.equal(alert.show_alert, true);

        memberships.set(`-1001:${user}`, "member");
        await press(user, "join:check");
        assert.equal(lastText(), fa.join.done);

        await send(user, "https://video.example/7");
        assert.equal(uploads().length, 1);

        // admins don't have to join
        calls.length = 0;
        store.touchUser(ADMIN);
        store.setQuality(ADMIN, "720");
        await send(ADMIN, "https://video.example/8");
        assert.equal(uploads().length, 1);
    } finally {
        store.setSetting("channels", null);
    }
});

// ---- admin panel

test("only admins can open the admin panel", async () => {
    const user = newUser();
    await send(user, "/admin");
    assert.equal(lastText(), en.admin.notAdmin);

    await press(user, "a:stats");
    assert.equal(calls.at(-1).params.text, en.admin.notAdmin);

    calls.length = 0;
    await send(ADMIN, "/admin");
    assert.equal(lastText(), messages(store.getUser(ADMIN).language).admin.title);
    assert.ok(buttons().some(b => b.callback_data === "a:bc"));
});

test("stats", async () => {
    store.setLanguage(ADMIN, "en");
    await press(ADMIN, "a:stats");

    const stats = store.stats();
    assert.ok(stats.users > 5);
    assert.ok(lastText().includes(`👥 users: ${stats.users}`));
    assert.ok(lastText().includes("• video:"));
});

test("broadcasts reach everyone, users who blocked the bot are skipped next time", async () => {
    store.setLanguage(ADMIN, "fa");
    const blocker = newUser();
    blockedUsers.add(blocker);
    const targets = store.broadcastTargets();

    await press(ADMIN, "a:bc");
    assert.equal(lastText(), fa.admin.broadcastPrompt);

    await send(ADMIN, "hello everyone");
    // a preview, then the confirmation
    const preview = calls.find(c => c.method === "copyMessage");
    assert.equal(preview.params.chat_id, ADMIN);
    assert.equal(lastText(), format(fa.admin.broadcastConfirm, { count: targets.length }));

    calls.length = 0;
    await press(ADMIN, "a:bc:go");
    while (bot.admin.broadcasting) await new Promise(r => setTimeout(r, 20));

    const copies = calls.filter(c => c.method === "copyMessage");
    assert.deepEqual(copies.map(c => c.params.chat_id).sort((a, b) => a - b), targets);
    assert.ok(copies.every(c => c.params.from_chat_id === ADMIN));
    assert.equal(lastText(), format(fa.admin.broadcastDone, { sent: targets.length - 1, blocked: 1, failed: 0 }));

    assert.equal(store.getUser(blocker).blocked, 1);
    assert.ok(!store.broadcastTargets().includes(blocker));
});

test("users that block the bot are noticed", async () => {
    const user = newUser();
    await bot.handleUpdate({ update_id: 1, my_chat_member: {
        chat: { id: user, type: "private" }, from: { id: user },
        new_chat_member: { status: "kicked" },
    }});
    assert.equal(store.getUser(user).blocked, 1);

    // writing to the bot again unblocks them
    await send(user, "hi");
    assert.equal(store.getUser(user).blocked, 0);
});

test("banning and unbanning users", async () => {
    store.setLanguage(ADMIN, "en");
    const user = newUser("en", "720");

    await press(ADMIN, "a:ban");
    await send(ADMIN, "not a number");
    assert.equal(lastText(), en.admin.userInvalid);
    await send(ADMIN, "999999");
    assert.equal(lastText(), en.admin.userNotFound);
    await send(ADMIN, String(user));
    assert.equal(lastText(), format(en.admin.userBanned, { id: user }));

    calls.length = 0;
    await send(user, "https://video.example/9");
    assert.equal(lastText(), en.banned);
    assert.equal(requests.length, 0);

    await press(ADMIN, "a:ban");
    await send(ADMIN, `-${user}`);
    assert.equal(lastText(), format(en.admin.userUnbanned, { id: user }));
    await send(user, "https://video.example/9");
    assert.equal(uploads().length, 1);

    // admins can't be banned
    await press(ADMIN, "a:ban");
    await send(ADMIN, String(ADMIN));
    assert.equal(lastText(), en.admin.userIsAdmin);
});

test("maintenance mode", async () => {
    store.setLanguage(ADMIN, "en");
    store.setQuality(ADMIN, "720");
    const user = newUser("en", "720");

    await press(ADMIN, "a:mt");
    assert.equal(store.getSetting("maintenance"), true);

    await send(user, "https://video.example/10");
    assert.equal(lastText(), en.maintenance);

    // admins can still use the bot
    calls.length = 0;
    await send(ADMIN, "https://video.example/10");
    assert.equal(uploads().length, 1);

    await press(ADMIN, "a:mt");
    assert.equal(store.getSetting("maintenance"), false);
});

test("custom welcome messages", async () => {
    store.setLanguage(ADMIN, "en");
    await press(ADMIN, "a:wl:fa");
    assert.equal(lastText(), en.admin.welcomePrompt);
    await send(ADMIN, "به ربات ما خوش آمدید 🌹");
    assert.ok(lastText().startsWith(en.admin.welcomeSaved));

    const user = nextUser++;
    await send(user, "/start");
    await press(user, "lang:fa");
    assert.equal(lastText(), "به ربات ما خوش آمدید 🌹");

    // english users still get the default one
    await press(user, "lang:en");
    assert.equal(lastText(), en.welcome);

    await press(ADMIN, "a:wl:reset");
    assert.equal(store.getSetting("welcome.fa"), undefined);
});

test("adding and removing required channels", async () => {
    store.setLanguage(ADMIN, "en");

    await press(ADMIN, "a:ch:add");
    assert.equal(lastText(), en.admin.channelPrompt);

    await send(ADMIN, "@missing");
    assert.equal(lastText(), en.admin.channelNotFound);
    await send(ADMIN, "@noadmin");
    assert.equal(lastText(), en.admin.channelNotAdmin);

    await send(ADMIN, "https://t.me/chan");
    assert.ok(lastText().startsWith(format(en.admin.channelAdded, { title: "my channel" })));
    assert.deepEqual(store.getSetting("channels"), [{ id: -1001, title: "my channel", link: "https://t.me/chan" }]);

    // a forwarded post works too, and doesn't add the channel twice
    await press(ADMIN, "a:ch:add");
    await send(ADMIN, "", { forward_origin: { type: "channel", chat: { id: -1001 } } });
    assert.equal(store.getSetting("channels").length, 1);

    await press(ADMIN, "a:ch:rm:0");
    assert.deepEqual(store.getSetting("channels"), []);
});

test("/cancel leaves an admin question", async () => {
    store.setLanguage(ADMIN, "en");
    await press(ADMIN, "a:ban");
    await send(ADMIN, "/cancel");
    assert.equal(lastText(), en.admin.canceled);
    assert.equal(bot.admin.isWaiting(ADMIN), false);
});

// ---- helpers

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

    assert.equal(serviceOf("https://www.youtube.com/watch?v=1"), "youtube");
    assert.equal(serviceOf("https://youtu.be/1"), "youtube");
    assert.equal(serviceOf("https://x.com/a/status/1"), "twitter");
    assert.equal(serviceOf("https://vm.tiktok.com/abc"), "tiktok");
    assert.equal(serviceOf("not a link"), "other");

    assert.equal(errorText(fa, "error.api.content.too_long", { limit: 180 }), format(fa.errors.tooLong, { limit: 180 }));
    assert.equal(errorText(fa, "error.api.link.unsupported"), fa.errors.unsupported);
    assert.equal(errorText(fa, "error.api.auth.key.invalid"), fa.errors.config);
    assert.match(errorText(fa, "error.api.something.new"), /something\.new/);

    assert.throws(() => loadConfig({}), /BOT_TOKEN/);
    assert.throws(() => loadConfig({ BOT_TOKEN: "x", VIDEO_QUALITY: "999" }), /VIDEO_QUALITY/);
    assert.equal(loadConfig({ BOT_TOKEN: "x" }).maxFileSize, 50 * 1024 * 1024);
    assert.equal(loadConfig({ BOT_TOKEN: "x", TELEGRAM_API_URL: "http://bot-api:8081" }).maxFileSize, 2000 * 1024 * 1024);
    assert.deepEqual([...loadConfig({ BOT_TOKEN: "x", ADMIN_IDS: "1, 2 x 3" }).adminIds], [1, 2, 3]);
});
