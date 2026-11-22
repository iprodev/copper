import fs from "node:fs";
import crypto from "node:crypto";

import { Admin } from "./admin.js";
import { messages, errorText, format, LANGUAGES } from "./messages.js";
import { downloadToFile, DownloadError, mediaKind } from "./download.js";

const LINK = /https?:\/\/[^\s<>"'«»]+/i;
// telegram albums hold up to 10 items, posts with more are sent as several albums
const MAX_ITEMS = 10;
const MAX_PICKER_ITEMS = 30;
const PHOTO_LIMIT = 10 * 1024 * 1024;

// a link waits this long for the user to pick a quality
const JOB_LIFETIME = 15 * 60 * 1000;
// a successful membership check is remembered this long
const MEMBERSHIP_CACHE = 10 * 60 * 1000;

export const QUALITIES = ["1080", "720", "480", "360"];

// telegram method, form field and chat action for each kind of media
const SENDERS = {
    video: ["sendVideo", "video", "upload_video", { supports_streaming: true }],
    audio: ["sendAudio", "audio", "upload_voice"],
    photo: ["sendPhoto", "photo", "upload_photo"],
    animation: ["sendAnimation", "animation", "upload_video"],
    document: ["sendDocument", "document", "upload_document"],
};

const SERVICE_ALIASES = {
    "youtu.be": "youtube", "x.com": "twitter", "t.co": "twitter", "redd.it": "reddit",
    "pin.it": "pinterest", "fb.watch": "facebook", "instagr.am": "instagram",
    "bsky.app": "bluesky", "on.soundcloud.com": "soundcloud", "vk.ru": "vk", "ok.ru": "ok",
};

// rough service name of a link, only for the download stats
export const serviceOf = (link) => {
    try {
        const host = new URL(link).hostname.replace(/^(www|m|mobile|vm|vt)\./, "");
        return SERVICE_ALIASES[host] ?? host.split(".").slice(-2)[0];
    } catch {
        return "other";
    }
}

// the first link in a message, from telegram's entities or the text itself
export const extractLink = (message) => {
    const text = message.text ?? message.caption ?? "";
    const entities = message.entities ?? message.caption_entities ?? [];

    for (const entity of entities) {
        if (entity.type === "text_link" && /^https?:\/\//i.test(entity.url)) {
            return entity.url;
        }
        if (entity.type === "url") {
            // offsets are in utf-16 code units, like javascript strings
            const link = text.slice(entity.offset, entity.offset + entity.length);
            // telegram also marks links without a scheme
            return /^https?:\/\//i.test(link) ? link : `https://${link}`;
        }
    }

    return text.match(LINK)?.[0];
}

class Semaphore {
    #free;
    #waiting = [];

    constructor(count) {
        this.#free = count;
    }

    async run(fn) {
        if (this.#free > 0) {
            this.#free--;
        } else {
            await new Promise(resolve => this.#waiting.push(resolve));
        }

        try {
            return await fn();
        } finally {
            const next = this.#waiting.shift();
            if (next) next();
            else this.#free++;
        }
    }
}

const button = (text, data) => ({ text, callback_data: data });

export class Bot {
    #config;
    #telegram;
    #fetchr;
    #store;
    #fetch;
    #admin;
    #slots;
    #busy = new Set();
    #recent = new Map();
    #jobs = new Map();
    #members = new Map();

    constructor({ config, telegram, fetchr, store, fetch = globalThis.fetch }) {
        this.#config = config;
        this.#telegram = telegram;
        this.#fetchr = fetchr;
        this.#store = store;
        this.#fetch = fetch;
        this.#slots = new Semaphore(config.concurrency);
        this.#admin = new Admin({
            telegram,
            store,
            botId: Number(config.token.split(":")[0]),
            isAdmin: (id) => this.isAdmin(id),
        });
    }

    get admin() {
        return this.#admin;
    }

    isAdmin(id) {
        return this.#config.adminIds?.has(id) ?? false;
    }

    async handleUpdate(update) {
        if (update.callback_query) return this.#onCallback(update.callback_query);
        if (update.my_chat_member) return this.#onChatMember(update.my_chat_member);
        if (update.message) return this.#onMessage(update.message);
    }

    #texts(user, fallback) {
        return messages(user?.language ?? fallback);
    }

    #limitMB() {
        return Math.round(this.#config.maxFileSize / 1024 / 1024);
    }

    #mainKeyboard(t) {
        return {
            keyboard: [
                [{ text: t.buttons.help }, { text: t.buttons.settings }],
                [{ text: t.buttons.language }],
            ],
            resize_keyboard: true,
            is_persistent: true,
        };
    }

    #languageKeyboard() {
        return {
            inline_keyboard: [[
                button("🇮🇷 فارسی", "lang:fa"),
                button("🇬🇧 English", "lang:en"),
            ]],
        };
    }

    #qualityLabel(t, quality) {
        if (quality === "ask") return t.quality.ask;
        if (quality === "audio") return t.quality.audio;
        return `${quality}p`;
    }

    #qualityKeyboard(t, jobId) {
        return {
            inline_keyboard: [
                [button("🎬 1080p", `q:${jobId}:1080`), button("🎬 720p", `q:${jobId}:720`)],
                [button("🎬 480p", `q:${jobId}:480`), button("🎬 360p", `q:${jobId}:360`)],
                [button(t.quality.audio, `q:${jobId}:audio`)],
                [button(t.quality.cancel, `q:${jobId}:x`)],
            ],
        };
    }

    #settingsView(t, current) {
        const option = (quality) =>
            button(`${quality === current ? "✅ " : ""}${this.#qualityLabel(t, quality)}`, `set:${quality}`);

        return {
            text: format(t.settings.title, { current: this.#qualityLabel(t, current) }),
            markup: {
                inline_keyboard: [
                    [option("ask")],
                    [option("1080"), option("720")],
                    [option("480"), option("360")],
                    [option("audio")],
                ],
            },
        };
    }

    #welcomeText(t, language) {
        return this.#store.getSetting(`welcome.${language}`) ?? t.welcome;
    }

    async #sendWelcome(chatId, user, t) {
        const language = user.language ?? "en";
        await this.#telegram.sendMessage(chatId, this.#welcomeText(t, language), {
            reply_markup: this.#mainKeyboard(t),
        });
    }

    // the command of a message: /command, or one of the keyboard buttons
    #command(text) {
        const command = text.match(/^\/(\w+)(@\w+)?/)?.[1]?.toLowerCase();
        if (command) return command;

        for (const t of Object.values(LANGUAGES)) {
            for (const [name, label] of Object.entries(t.buttons)) {
                if (text === label) return name;
            }
        }
    }

    async #onChatMember(update) {
        // the user blocked or unblocked the bot
        if (update.chat?.type !== "private") return;

        const status = update.new_chat_member?.status;
        if (status === "kicked") this.#store.setBlocked(update.chat.id, true);
        if (status === "member") this.#store.setBlocked(update.chat.id, false);
    }

    async #onMessage(message) {
        // only private chats, so the bot doesn't answer every link in groups
        if (message.chat?.type !== "private" || !message.from) return;

        const userId = message.from.id;
        const chatId = message.chat.id;
        const { user } = this.#store.touchUser(userId);
        const t = this.#texts(user, message.from.language_code);
        const admin = this.isAdmin(userId);

        const reply = (text, extra = {}) => this.#telegram.sendMessage(chatId, text, {
            reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
            ...extra,
        });

        const text = (message.text ?? message.caption ?? "").trim();
        const command = this.#command(text);

        // an admin answering a question of the admin panel
        if (admin && this.#admin.isWaiting(userId) && !text.startsWith("/")) {
            return this.#admin.handleInput(message, t);
        }

        if (user.banned && !admin) {
            return reply(t.banned);
        }

        switch (command) {
            case "start":
                // new users choose a language first
                if (!user.language) {
                    return this.#telegram.sendMessage(chatId, t.chooseLanguage, {
                        reply_markup: this.#languageKeyboard(),
                    });
                }
                return this.#sendWelcome(chatId, user, t);

            case "help":
                return reply(format(t.help, { limit: this.#limitMB() }), {
                    reply_markup: this.#mainKeyboard(t),
                });

            case "language":
                return this.#telegram.sendMessage(chatId, t.chooseLanguage, {
                    reply_markup: this.#languageKeyboard(),
                });

            case "settings": {
                const { text: settingsText, markup } = this.#settingsView(t, user.quality);
                return reply(settingsText, { reply_markup: markup });
            }

            case "admin":
                if (!admin) return reply(t.admin.notAdmin);
                return this.#admin.showMenu(chatId, t);

            case "cancel":
                this.#admin.cancel(userId);
                return reply(t.admin.canceled);
        }

        if (this.#store.getSetting("maintenance", false) && !admin) {
            return reply(t.maintenance);
        }

        const link = extractLink(message);
        if (!link) {
            return reply(t.noLink);
        }

        if (!await this.#checkMembership(userId, chatId, t)) {
            return;
        }

        if (command === "audio" || user.quality === "audio") {
            return this.#start({ userId, chatId, link, t, downloadMode: "audio", replyTo: message.message_id });
        }

        if (user.quality !== "ask") {
            return this.#start({ userId, chatId, link, t, quality: user.quality, replyTo: message.message_id });
        }

        // ask for the quality
        const jobId = this.#addJob({ userId, chatId, link });
        return reply(t.quality.choose, { reply_markup: this.#qualityKeyboard(t, jobId) });
    }

    #addJob(job) {
        const now = Date.now();
        for (const [id, old] of this.#jobs) {
            if (now - old.created > JOB_LIFETIME) this.#jobs.delete(id);
        }

        const id = crypto.randomBytes(6).toString("base64url");
        this.#jobs.set(id, { ...job, created: now });
        return id;
    }

    async #onCallback(query) {
        const userId = query.from.id;
        const data = query.data ?? "";
        const { user } = this.#store.touchUser(userId);
        let t = this.#texts(user, query.from.language_code);
        const admin = this.isAdmin(userId);

        const answer = (text, alert = false) =>
            this.#telegram.answerCallbackQuery(query.id, text, alert).catch(() => {});

        const chatId = query.message?.chat?.id;
        const messageId = query.message?.message_id;
        const edit = (text, markup) => chatId && this.#telegram.editMessageText(
            chatId, messageId, text, markup ? { reply_markup: markup } : {}
        ).catch(() => {});

        if (data.startsWith("a:")) {
            if (!admin) return answer(t.admin.notAdmin, true);
            return this.#admin.handleCallback(query, t);
        }

        if (user.banned && !admin) {
            return answer(t.banned, true);
        }

        if (data.startsWith("lang:")) {
            const language = data.slice(5) === "fa" ? "fa" : "en";
            this.#store.setLanguage(userId, language);
            t = messages(language);

            await answer();
            await edit(t.languageSet);
            if (chatId) await this.#sendWelcome(chatId, { ...user, language }, t);
            return;
        }

        if (data.startsWith("set:")) {
            const quality = data.slice(4);
            if (!["ask", "audio", ...QUALITIES].includes(quality)) return answer();

            this.#store.setQuality(userId, quality);
            await answer(format(t.settings.saved, { current: this.#qualityLabel(t, quality) }));

            const { text, markup } = this.#settingsView(t, quality);
            return edit(text, markup);
        }

        if (data === "join:check") {
            this.#members.delete(userId);
            if (!await this.#isMember(userId)) {
                return answer(t.join.notYet, true);
            }
            await answer();
            return edit(t.join.done);
        }

        if (data.startsWith("q:")) {
            const [ , jobId, choice ] = data.split(":");
            const job = this.#jobs.get(jobId);

            if (!job || job.userId !== userId) {
                await answer();
                return edit(t.quality.expired);
            }

            this.#jobs.delete(jobId);
            await answer();

            if (choice === "x") {
                return edit(t.quality.canceled);
            }

            if (this.#store.getSetting("maintenance", false) && !admin) {
                return edit(t.maintenance);
            }

            if (!await this.#checkMembership(userId, job.chatId, t)) {
                return edit(t.join.notYet);
            }

            return this.#start({
                userId,
                chatId: job.chatId,
                link: job.link,
                t,
                ...(choice === "audio" ? { downloadMode: "audio" } : { quality: QUALITIES.includes(choice) ? choice : undefined }),
                statusMessageId: messageId,
            });
        }

        return answer();
    }

    async #isMember(userId) {
        if (this.isAdmin(userId)) return true;

        const channels = this.#store.getSetting("channels", []);
        if (!channels.length) return true;

        const cached = this.#members.get(userId);
        if (cached && Date.now() - cached < MEMBERSHIP_CACHE) return true;

        for (const channel of channels) {
            try {
                const member = await this.#telegram.getChatMember(channel.id, userId);
                const joined = ["creator", "administrator", "member"].includes(member.status)
                    || (member.status === "restricted" && member.is_member);
                if (!joined) return false;
            } catch {
                // the bot lost access to the channel: users aren't locked out because of it
            }
        }

        this.#members.set(userId, Date.now());
        return true;
    }

    // returns false (and asks the user to join) if a required channel is missing
    async #checkMembership(userId, chatId, t) {
        if (await this.#isMember(userId)) return true;

        const channels = this.#store.getSetting("channels", []);
        await this.#telegram.sendMessage(chatId, t.join.prompt, {
            reply_markup: {
                inline_keyboard: [
                    ...channels.map(channel => [{ text: `📢 ${channel.title}`, url: channel.link }]),
                    [button(t.join.check, "join:check")],
                ],
            },
        });
        return false;
    }

    #isRateLimited(userId) {
        if (this.isAdmin(userId)) return false;

        const now = Date.now();
        const times = (this.#recent.get(userId) ?? []).filter(time => now - time < 60000);

        if (times.length >= this.#config.userRateLimit) {
            this.#recent.set(userId, times);
            return true;
        }

        times.push(now);
        this.#recent.set(userId, times);

        // forget users that have been quiet for a while
        if (this.#recent.size > 10000) {
            for (const [id, list] of this.#recent) {
                if (!list.some(time => now - time < 60000)) this.#recent.delete(id);
            }
        }

        return false;
    }

    async #start({ userId, chatId, link, t, downloadMode = "auto", quality, replyTo, statusMessageId }) {
        const say = (text) => statusMessageId
            ? this.#telegram.editMessageText(chatId, statusMessageId, text).catch(() => {})
            : this.#telegram.sendMessage(chatId, text, replyTo ? {
                reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
            } : {});

        if (this.#busy.has(userId)) return say(t.busy);
        if (this.#isRateLimited(userId)) return say(t.rateLimited);

        this.#busy.add(userId);
        try {
            await this.#slots.run(() => this.#process({
                chatId, link, t, downloadMode, quality, replyTo, statusMessageId,
            }));
        } finally {
            this.#busy.delete(userId);
        }
    }

    async #process({ chatId, link, t, downloadMode, quality, replyTo, statusMessageId }) {
        let statusId = statusMessageId;
        if (statusId) {
            await this.#telegram.editMessageText(chatId, statusId, t.working).catch(() => {});
        } else {
            const status = await this.#telegram.sendMessage(chatId, t.working, replyTo ? {
                reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
            } : {});
            statusId = status.message_id;
        }

        const setStatus = (text) =>
            this.#telegram.editMessageText(chatId, statusId, text).catch(() => {});

        let result;
        try {
            result = await this.#fetchr.request(link, {
                downloadMode,
                videoQuality: quality ?? this.#config.videoQuality,
            });
        } catch {
            return setStatus(t.errors.generic);
        }

        if (result?.status === "error") {
            return setStatus(errorText(t, result.error?.code, result.error?.context));
        }

        let items;
        if (result?.status === "tunnel" || result?.status === "redirect") {
            items = [{ url: result.url, filename: result.filename }];
        } else if (result?.status === "picker") {
            items = downloadMode === "audio" && result.audio
                ? [{ url: result.audio, filename: result.audioFilename }]
                : (result.picker ?? []).slice(0, MAX_PICKER_ITEMS).map(item => ({ url: item.url }));
        }

        if (!items?.length) {
            return setStatus(errorText(t, result?.status));
        }

        const files = [];
        const failures = [];

        try {
            for (const [i, item] of items.entries()) {
                await setStatus(items.length > 1 ? `${t.downloading} (${i + 1}/${items.length})` : t.downloading);

                try {
                    files.push(await this.#download(item));
                } catch (e) {
                    failures.push(e instanceof DownloadError && e.reason === "too_big"
                        ? format(t.tooBig, { limit: this.#limitMB() })
                        : t.errors.download);
                }
            }

            if (files.length) {
                await setStatus(t.uploading);
                if (!await this.#upload(chatId, files)) {
                    failures.push(t.errors.upload);
                } else {
                    this.#store.countDownload(serviceOf(link));
                }
            }
        } finally {
            await Promise.all(files.map(file => fs.promises.rm(file.path, { force: true })));
        }

        if (failures.length) {
            // the status message stays and explains what went wrong
            return setStatus(failures[0]);
        }

        await this.#telegram.deleteMessage(chatId, statusId).catch(() => {});
    }

    async #download(item) {
        const file = await downloadToFile(this.#fetchr.internalURL(item.url), {
            dir: this.#config.tempDir,
            maxSize: this.#config.maxFileSize,
            filename: item.filename,
            fetch: this.#fetch,
        });

        file.kind = mediaKind(file.filename, file.type);
        if (file.kind === "photo" && file.size > PHOTO_LIMIT) {
            file.kind = "document";
        }

        return file;
    }

    // returns false if anything couldn't be sent
    async #upload(chatId, files) {
        let ok = true;

        // several photos and videos go out as albums of up to 10
        const album = files.filter(file => file.kind === "photo" || file.kind === "video");
        const single = album.length > 1 ? files.filter(file => !album.includes(file)) : files;

        if (album.length > 1) {
            await this.#telegram.sendChatAction(chatId, "upload_photo").catch(() => {});

            for (let i = 0; i < album.length; i += MAX_ITEMS) {
                const chunk = album.slice(i, i + MAX_ITEMS);
                try {
                    await this.#telegram.sendMediaGroup(chatId, chunk);
                } catch {
                    // one bad file fails the whole album, so they're sent one by one
                    for (const file of chunk) {
                        ok = await this.#sendFile(chatId, file) && ok;
                    }
                }
            }
        }

        for (const file of single) {
            ok = await this.#sendFile(chatId, file) && ok;
        }

        return ok;
    }

    async #sendFile(chatId, file) {
        const [ method, field, action, extra ] = SENDERS[file.kind];
        await this.#telegram.sendChatAction(chatId, action).catch(() => {});

        try {
            await this.#telegram.sendFile(method, field, chatId, file, extra);
            return true;
        } catch {
            if (file.kind === "document") return false;
        }

        // telegram refuses some files as media (e.g. unusual formats),
        // they still work as documents
        try {
            await this.#telegram.sendFile("sendDocument", "document", chatId, file);
            return true;
        } catch {
            return false;
        }
    }
}
