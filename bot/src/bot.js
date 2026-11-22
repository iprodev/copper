import fs from "node:fs";

import { messages, errorText } from "./messages.js";
import { downloadToFile, DownloadError, mediaKind } from "./download.js";

const LINK = /https?:\/\/[^\s<>"'«»]+/i;
// telegram albums hold up to 10 items, posts with more are sent as several albums
const MAX_ITEMS = 10;
const MAX_PICKER_ITEMS = 30;
const PHOTO_LIMIT = 10 * 1024 * 1024;

// telegram method, form field and chat action for each kind of media
const SENDERS = {
    video: ["sendVideo", "video", "upload_video", { supports_streaming: true }],
    audio: ["sendAudio", "audio", "upload_voice"],
    photo: ["sendPhoto", "photo", "upload_photo"],
    animation: ["sendAnimation", "animation", "upload_video"],
    document: ["sendDocument", "document", "upload_document"],
};

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

export class Bot {
    #config;
    #telegram;
    #fetchr;
    #fetch;
    #jobs;
    #busy = new Set();
    #recent = new Map();

    constructor({ config, telegram, fetchr, fetch = globalThis.fetch }) {
        this.#config = config;
        this.#telegram = telegram;
        this.#fetchr = fetchr;
        this.#fetch = fetch;
        this.#jobs = new Semaphore(config.concurrency);
    }

    async handleUpdate(update) {
        const message = update.message;
        if (!message?.chat || !message.from) return;

        // only private chats, so the bot doesn't answer every link in groups
        if (message.chat.type !== "private") return;

        const t = messages(message.from.language_code);
        const reply = (text) => this.#telegram.sendMessage(message.chat.id, text, {
            reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        });

        const { allowedUsers } = this.#config;
        if (allowedUsers && !allowedUsers.has(message.from.id)) {
            return reply(t.notAllowed);
        }

        const text = (message.text ?? message.caption ?? "").trim();
        const command = text.match(/^\/(\w+)(@\w+)?/)?.[1]?.toLowerCase();

        if (command === "start" || command === "help") {
            return reply(t.help);
        }

        const link = extractLink(message);
        if (!link) {
            return reply(t.noLink);
        }

        const user = message.from.id;
        if (this.#busy.has(user)) {
            return reply(t.busy);
        }

        if (this.#isRateLimited(user)) {
            return reply(t.rateLimited);
        }

        this.#busy.add(user);
        try {
            await this.#jobs.run(() => this.#process(message, link, {
                t,
                downloadMode: command === "audio" ? "audio" : "auto",
            }));
        } finally {
            this.#busy.delete(user);
        }
    }

    #isRateLimited(user) {
        const now = Date.now();
        const times = (this.#recent.get(user) ?? []).filter(time => now - time < 60000);

        if (times.length >= this.#config.userRateLimit) {
            this.#recent.set(user, times);
            return true;
        }

        times.push(now);
        this.#recent.set(user, times);

        // forget users that have been quiet for a while
        if (this.#recent.size > 10000) {
            for (const [id, list] of this.#recent) {
                if (!list.some(time => now - time < 60000)) this.#recent.delete(id);
            }
        }

        return false;
    }

    async #process(message, link, { t, downloadMode }) {
        const chatId = message.chat.id;

        const status = await this.#telegram.sendMessage(chatId, t.working, {
            reply_parameters: { message_id: message.message_id, allow_sending_without_reply: true },
        });

        const setStatus = (text) =>
            this.#telegram.editMessageText(chatId, status.message_id, text).catch(() => {});

        let result;
        try {
            result = await this.#fetchr.request(link, {
                downloadMode,
                videoQuality: this.#config.videoQuality,
            });
        } catch {
            return setStatus(t.errors.generic());
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
            return setStatus(t.errors.generic(result?.status));
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
                        ? t.tooBig(Math.round(this.#config.maxFileSize / 1024 / 1024))
                        : t.errors.download);
                }
            }

            if (files.length) {
                await setStatus(t.uploading);
                if (!await this.#upload(chatId, files)) {
                    failures.push(t.errors.upload);
                }
            }
        } finally {
            await Promise.all(files.map(file => fs.promises.rm(file.path, { force: true })));
        }

        if (failures.length) {
            // the status message stays and explains what went wrong
            return setStatus(failures[0]);
        }

        await this.#telegram.deleteMessage(chatId, status.message_id).catch(() => {});
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
