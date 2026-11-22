import fs from "node:fs";
import crypto from "node:crypto";

import { Admin } from "./admin.js";
import { sendBackup } from "./backup.js";
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
// files that were sent are sent again from telegram for this long
const FILE_CACHE_AGE = 30 * 24 * 60 * 60 * 1000;

export const QUALITIES = ["1080", "720", "480", "360"];

// telegram method, form field and chat action for each kind of media
const SENDERS = {
    video: ["sendVideo", "video", "upload_video", { supports_streaming: true }],
    audio: ["sendAudio", "audio", "upload_voice"],
    photo: ["sendPhoto", "photo", "upload_photo"],
    animation: ["sendAnimation", "animation", "upload_video"],
    document: ["sendDocument", "document", "upload_document"],
};

// inline result type and file id field for each kind of media
const INLINE_TYPES = {
    video: ["video", "video_file_id"],
    audio: ["audio", "audio_file_id"],
    photo: ["photo", "photo_file_id"],
    animation: ["gif", "gif_file_id"],
    document: ["document", "document_file_id"],
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

// key of the file cache. only a hash: the link itself isn't stored
export const cacheKey = (link, downloadMode, quality) => crypto
    .createHash("sha256")
    .update(downloadMode === "audio" ? `${link.trim()}\naudio` : `${link.trim()}\nauto\n${quality}`)
    .digest("base64url");

// the file in a message that the bot sent
const sentFile = (message) => {
    if (message?.photo?.length) {
        return { kind: "photo", fileId: message.photo.at(-1).file_id };
    }
    for (const kind of ["video", "animation", "audio", "document"]) {
        if (message?.[kind]?.file_id) {
            return { kind, fileId: message[kind].file_id };
        }
    }
}

// runs tasks with a limited concurrency, tells waiting ones their position
class Queue {
    #free;
    #waiting = [];

    constructor(count) {
        this.#free = count;
    }

    async run(fn, onWait) {
        if (this.#free > 0) {
            this.#free--;
        } else {
            await new Promise(resolve => {
                this.#waiting.push({ resolve, onWait });
                onWait?.(this.#waiting.length);
            });
        }

        try {
            return await fn();
        } finally {
            const next = this.#waiting.shift();
            if (next) {
                next.resolve();
                this.#waiting.forEach((waiting, i) => waiting.onWait?.(i + 1));
            } else {
                this.#free++;
            }
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
    #queue;
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
        this.#queue = new Queue(config.concurrency);
        this.#admin = new Admin({
            telegram,
            store,
            botId: Number(config.token.split(":")[0]),
            isAdmin: (id) => this.isAdmin(id),
            backup: () => this.backup(),
            defaultCaption: () => this.#defaultCaption(),
        });
    }

    get admin() {
        return this.#admin;
    }

    isAdmin(id) {
        return this.#config.adminIds?.has(id) ?? false;
    }

    backup() {
        return sendBackup({
            store: this.#store,
            telegram: this.#telegram,
            adminIds: this.#config.adminIds ?? [],
            dir: this.#config.tempDir,
        });
    }

    async handleUpdate(update) {
        if (update.callback_query) return this.#onCallback(update.callback_query);
        if (update.inline_query) return this.#onInline(update.inline_query);
        if (update.my_chat_member) return this.#onChatMember(update.my_chat_member);
        if (update.message) return this.#onMessage(update.message);
    }

    // ------------------------------------------------------------ settings

    #texts(user, fallback) {
        return messages(user?.language ?? fallback);
    }

    #limitMB() {
        return Math.round(this.#config.maxFileSize / 1024 / 1024);
    }

    #defaultCaption() {
        return this.#config.botUsername ? `📥 @${this.#config.botUsername}` : "";
    }

    // the text under sent files, set in the admin panel ("" means none)
    #caption() {
        return this.#store.getSetting("caption") ?? this.#defaultCaption();
    }

    #quota() {
        return {
            daily: this.#store.getSetting("quota.daily", 0),
            perInvite: this.#store.getSetting("quota.perInvite", 5),
        };
    }

    // downloads a user has today (Infinity without a limit)
    #dailyLimit(user) {
        const { daily, perInvite } = this.#quota();
        if (!daily || user.vip || this.isAdmin(user.id)) return Infinity;
        return daily + this.#store.countInvites(user.id) * perInvite;
    }

    #inviteLink(userId) {
        return `https://t.me/${this.#config.botUsername}?start=ref_${userId}`;
    }

    // ------------------------------------------------------------ keyboards

    #mainKeyboard(t) {
        return {
            keyboard: [
                [{ text: t.buttons.help }, { text: t.buttons.settings }],
                [{ text: t.buttons.invite }, { text: t.buttons.language }],
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

    #inviteText(t, user) {
        const { daily, perInvite } = this.#quota();
        const limit = this.#dailyLimit(user);

        return format(t.invite.title, {
            bonus: daily && perInvite ? format(t.invite.bonus, { perInvite }) : t.invite.noBonus,
            link: this.#inviteLink(user.id),
            count: this.#store.countInvites(user.id),
            used: this.#store.usageToday(user.id),
            limit: limit === Infinity ? t.invite.unlimited : limit,
        });
    }

    #welcomeText(t, language) {
        return this.#store.getSetting(`welcome.${language}`) ?? t.welcome;
    }

    async #sendWelcome(chatId, user, t) {
        await this.#telegram.sendMessage(chatId, this.#welcomeText(t, user.language ?? "en"), {
            reply_markup: this.#mainKeyboard(t),
        });
    }

    // ------------------------------------------------------------ updates

    // the command of a message: /command, or one of the keyboard buttons
    #command(text) {
        const match = text.match(/^\/(\w+)(?:@(\w+))?/);
        if (match) {
            // commands for other bots in groups
            const [ , command, bot ] = match;
            if (bot && this.#config.botUsername && bot.toLowerCase() !== this.#config.botUsername.toLowerCase()) {
                return "other-bot";
            }
            return command.toLowerCase();
        }

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
        if (!message.from || message.from.is_bot) return;

        const type = message.chat?.type;
        if (type === "group" || type === "supergroup") return this.#onGroupMessage(message);
        if (type !== "private") return;

        const userId = message.from.id;
        const chatId = message.chat.id;
        const { user, isNew } = this.#store.touchUser(userId);
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
            case "start": {
                const parameter = text.split(/\s+/)[1] ?? "";

                // someone opened an invite link
                const inviter = Number(parameter.match(/^ref_(\d+)$/)?.[1]);
                if (isNew && inviter && this.#store.setInvitedBy(userId, inviter)) {
                    await this.#notifyInviter(inviter);
                }

                // a link from inline mode that wasn't downloaded yet
                const jobId = parameter.match(/^dl_([\w-]+)$/)?.[1];
                const job = jobId && this.#jobs.get(jobId);
                if (job && job.userId === userId && user.language) {
                    this.#jobs.delete(jobId);
                    return this.#handleLink({ user, chatId, link: job.link, t, replyTo: message.message_id });
                }

                // new users choose a language first
                if (!user.language) {
                    return this.#telegram.sendMessage(chatId, t.chooseLanguage, {
                        reply_markup: this.#languageKeyboard(),
                    });
                }
                return this.#sendWelcome(chatId, user, t);
            }

            case "help":
                return reply(format(t.help, { limit: this.#limitMB(), bot: this.#config.botUsername ?? "" }), {
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

            case "invite":
                return reply(this.#inviteText(t, user));

            case "admin":
                if (!admin) return reply(t.admin.notAdmin);
                return this.#admin.showMenu(chatId, t);

            case "cancel":
                this.#admin.cancel(userId);
                return reply(t.admin.canceled);
        }

        const link = extractLink(message);
        if (!link) {
            return reply(t.noLink);
        }

        return this.#handleLink({
            user, chatId, link, t,
            audio: command === "audio",
            replyTo: message.message_id,
        });
    }

    async #notifyInviter(inviterId) {
        const inviter = this.#store.getUser(inviterId);
        const t = this.#texts(inviter);
        const { daily, perInvite } = this.#quota();

        await this.#telegram.sendMessage(inviterId, format(t.invite.joined, {
            bonus: daily && perInvite ? format(t.invite.joinedBonus, { perInvite }) : "",
        })).catch(() => {});
    }

    // in groups the bot only answers /dl (or /audio) and mentions, when groups are on
    async #onGroupMessage(message) {
        if (!this.#store.getSetting("groups", false)) return;

        const text = (message.text ?? message.caption ?? "").trim();
        const command = this.#command(text);
        const username = this.#config.botUsername?.toLowerCase();
        const mentioned = username && text.toLowerCase().includes(`@${username}`);

        if (!["dl", "audio"].includes(command) && !mentioned) return;

        const userId = message.from.id;
        const { user } = this.#store.touchUser(userId);
        const t = this.#texts(user, message.from.language_code);

        const reply = (replyText) => this.#telegram.sendMessage(message.chat.id, replyText, {
            reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        });

        if (user.banned && !this.isAdmin(userId)) return;

        // the link can also be in the message the command replies to
        const link = extractLink(message) ?? (message.reply_to_message && extractLink(message.reply_to_message));
        if (!link) return reply(t.group.usage);

        return this.#handleLink({
            user,
            chatId: message.chat.id,
            link, t,
            audio: command === "audio",
            replyTo: message.message_id,
        });
    }

    // everything a link goes through before it's downloaded
    async #handleLink({ user, chatId, link, t, audio = false, replyTo }) {
        const userId = user.id;
        const admin = this.isAdmin(userId);

        const reply = (text, extra = {}) => this.#telegram.sendMessage(chatId, text, {
            ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
            ...extra,
        });

        if (this.#store.getSetting("maintenance", false) && !admin) {
            return reply(t.maintenance);
        }

        if (!await this.#checkMembership(userId, chatId, t)) {
            return;
        }

        if (this.#store.usageToday(userId) >= this.#dailyLimit(user)) {
            return reply(format(t.quota.exceeded, { limit: this.#dailyLimit(user) }));
        }

        if (audio || user.quality === "audio") {
            return this.#start({ userId, chatId, link, t, downloadMode: "audio", replyTo });
        }

        if (user.quality !== "ask") {
            return this.#start({ userId, chatId, link, t, quality: user.quality, replyTo });
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
                // in groups, other people's questions stay as they are
                if (!job) await edit(t.quality.expired);
                return;
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

            if (this.#store.usageToday(userId) >= this.#dailyLimit(user)) {
                return edit(format(t.quota.exceeded, { limit: this.#dailyLimit(user) }));
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

    // inline mode: files that were already sent are offered right away.
    // others have to go through the bot once, which the button leads to.
    async #onInline(query) {
        const userId = query.from.id;
        const user = this.#store.getUser(userId);
        const t = this.#texts(user, query.from.language_code);

        const answer = (results, extra = {}) => this.#telegram.answerInlineQuery(query.id, results, {
            cache_time: 30,
            is_personal: true,
            ...extra,
        }).catch(() => {});

        if (user?.banned && !this.isAdmin(userId)) return answer([]);

        const link = query.query?.match(LINK)?.[0];
        if (!link) {
            return answer([], { button: { text: t.inline.hint, start_parameter: "inline" } });
        }

        const preferred = user?.quality && user.quality !== "ask" ? [user.quality] : [];
        const options = [...new Set([...preferred, this.#config.videoQuality, ...QUALITIES, "audio"])];

        for (const option of options) {
            const items = this.#store.getFiles(
                cacheKey(link, option === "audio" ? "audio" : "auto", option),
                FILE_CACHE_AGE,
            );
            if (!items?.length) continue;

            const caption = this.#caption();
            return answer(items.map((item, i) => {
                const [ type, field ] = INLINE_TYPES[item.kind] ?? INLINE_TYPES.document;
                return {
                    type,
                    id: `${i}`,
                    [field]: item.fileId,
                    title: item.title || "fetchr",
                    ...(caption ? { caption } : {}),
                };
            }));
        }

        const jobId = this.#addJob({ userId, chatId: userId, link });
        return answer([], { button: { text: t.inline.notCached, start_parameter: `dl_${jobId}` } });
    }

    // ------------------------------------------------------------ channels

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

    // ------------------------------------------------------------ downloading

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
        const replyExtra = replyTo
            ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
            : {};

        const say = (text) => statusMessageId
            ? this.#telegram.editMessageText(chatId, statusMessageId, text).catch(() => {})
            : this.#telegram.sendMessage(chatId, text, replyExtra);

        if (this.#busy.has(userId)) return say(t.busy);
        if (this.#isRateLimited(userId)) return say(t.rateLimited);

        this.#busy.add(userId);
        try {
            // the status message is there before waiting, so the queue position can be shown
            let statusId = statusMessageId;
            if (!statusId) {
                statusId = (await this.#telegram.sendMessage(chatId, t.working, replyExtra)).message_id;
            }

            await this.#queue.run(
                () => this.#process({ userId, chatId, link, t, downloadMode, quality, statusId }),
                (position) => this.#telegram.editMessageText(
                    chatId, statusId, format(t.queued, { position }),
                ).catch(() => {}),
            );
        } finally {
            this.#busy.delete(userId);
        }
    }

    async #process({ userId, chatId, link, t, downloadMode, quality, statusId }) {
        // status updates don't hold up the work: the limiter sends them in
        // order, and only the latest of several waiting ones
        const setStatus = (text) =>
            this.#telegram.editMessageText(chatId, statusId, text).catch(() => {});

        setStatus(t.working);

        const videoQuality = quality ?? this.#config.videoQuality;
        const key = cacheKey(link, downloadMode, videoQuality);
        const caption = this.#caption();

        const done = async () => {
            this.#store.countUsage(userId);
            this.#store.countDownload(serviceOf(link));
            await this.#telegram.deleteMessage(chatId, statusId).catch(() => {});
        };

        // sent before: telegram sends the same files again right away
        const cached = this.#store.getFiles(key, FILE_CACHE_AGE);
        if (cached?.length) {
            setStatus(t.uploading);
            const { ok } = await this.#upload(chatId, cached, caption);
            if (ok) return done();
            // the files aren't valid anymore, they're downloaded again
            this.#store.deleteFiles(key);
        }

        let result;
        try {
            result = await this.#fetchr.request(link, { downloadMode, videoQuality });
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
        let sent = false;

        try {
            let lastProgress = 0;
            for (const [i, item] of items.entries()) {
                // telegram limits how often a message can be edited
                if (Date.now() - lastProgress > 1500) {
                    lastProgress = Date.now();
                    setStatus(items.length > 1 ? `${t.downloading} (${i + 1}/${items.length})` : t.downloading);
                }

                try {
                    files.push(await this.#download(item));
                } catch (e) {
                    failures.push(e instanceof DownloadError && e.reason === "too_big"
                        ? format(t.tooBig, { limit: this.#limitMB() })
                        : t.errors.download);
                }
            }

            if (files.length) {
                setStatus(t.uploading);
                const { ok, sentFiles } = await this.#upload(chatId, files, caption);

                if (ok) {
                    sent = true;
                    // complete posts are remembered for the next time
                    if (!failures.length && sentFiles.length === files.length) {
                        this.#store.setFiles(key, sentFiles);
                    }
                } else {
                    failures.push(t.errors.upload);
                }
            }
        } finally {
            await Promise.all(files.map(file => fs.promises.rm(file.path, { force: true })));
        }

        if (failures.length) {
            if (sent) {
                this.#store.countUsage(userId);
                this.#store.countDownload(serviceOf(link));
            }
            // the status message stays and explains what went wrong
            return setStatus(failures[0]);
        }

        return done();
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
        file.title = file.filename.replace(/\.[^.]+$/, "");

        return file;
    }

    // sends local files or ones telegram already has (fileId).
    // returns whether everything was sent, and the file ids telegram gave them.
    async #upload(chatId, files, caption) {
        let ok = true;
        const sentFiles = [];
        const remember = (file, message) => {
            const sent = sentFile(message);
            if (sent) sentFiles.push({ ...sent, title: file.title });
        };

        // several photos and videos go out as albums of up to 10
        const album = files.filter(file => file.kind === "photo" || file.kind === "video");
        const single = album.length > 1 ? files.filter(file => !album.includes(file)) : files;

        if (album.length > 1) {
            this.#telegram.sendChatAction(chatId, "upload_photo").catch(() => {});

            for (let i = 0; i < album.length; i += MAX_ITEMS) {
                const chunk = album.slice(i, i + MAX_ITEMS);
                try {
                    const messages = await this.#telegram.sendMediaGroup(chatId, chunk, i === 0 ? caption : undefined);
                    chunk.forEach((file, j) => remember(file, messages?.[j]));
                } catch {
                    if (chunk.some(file => file.fileId)) return { ok: false, sentFiles };
                    // one bad file fails the whole album, so they're sent one by one
                    for (const file of chunk) {
                        ok = await this.#sendFile(chatId, file, caption, remember) && ok;
                    }
                }
            }
        }

        for (const file of single) {
            const sent = await this.#sendFile(chatId, file, caption, remember);
            if (!sent && file.fileId) return { ok: false, sentFiles };
            ok = sent && ok;
        }

        return { ok, sentFiles };
    }

    async #sendFile(chatId, file, caption, remember) {
        const [ method, field, action, extra = {} ] = SENDERS[file.kind] ?? SENDERS.document;
        const options = { ...extra, ...(caption ? { caption } : {}) };
        this.#telegram.sendChatAction(chatId, action).catch(() => {});

        try {
            remember(file, await this.#telegram.sendFile(method, field, chatId, file, options));
            return true;
        } catch {
            if (file.kind === "document" || file.fileId) return false;
        }

        // telegram refuses some files as media (e.g. unusual formats),
        // they still work as documents
        try {
            const message = await this.#telegram.sendFile("sendDocument", "document", chatId, file, caption ? { caption } : {});
            remember({ ...file, kind: "document" }, message);
            return true;
        } catch {
            return false;
        }
    }
}
