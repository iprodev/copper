import fs from "node:fs";
import { Limiter } from "./limiter.js";

// methods that send or change messages go through the limiter
const LIMITED = new Set([
    "sendMessage", "editMessageText", "deleteMessage", "copyMessage", "forwardMessage",
    "sendPhoto", "sendVideo", "sendAudio", "sendDocument", "sendAnimation", "sendMediaGroup",
]);

export class TelegramError extends Error {
    constructor(method, response) {
        super(`telegram ${method}: ${response?.description || "request failed"}`);
        this.name = "TelegramError";
        this.code = response?.error_code;
        this.retryAfter = response?.parameters?.retry_after;
    }
}

// minimal telegram bot api client
export class Telegram {
    #base;
    #fetch;

    constructor({ token, apiUrl = "https://api.telegram.org", fetch = globalThis.fetch, limits }) {
        this.#base = `${apiUrl}/bot${token}`;
        this.#fetch = fetch;
        this.limiter = new Limiter(limits);
    }

    // priority "low" is for broadcasts. a key replaces a waiting request
    // with the same key (used for edits of the same message).
    call(method, params = {}, { signal, priority, key } = {}) {
        if (!LIMITED.has(method)) {
            return this.#request(method, params, signal);
        }

        const chatId = params instanceof FormData ? params.get("chat_id") : params.chat_id;
        return this.limiter.schedule(
            String(chatId),
            () => this.#request(method, params, signal),
            { priority, key },
        );
    }

    async #request(method, params, signal) {
        const isForm = params instanceof FormData;

        // errors never include the url, it contains the bot token
        const response = await this.#fetch(`${this.#base}/${method}`, {
            method: "POST",
            body: isForm ? params : JSON.stringify(params),
            headers: isForm ? undefined : { "content-type": "application/json" },
            signal,
        });

        const data = await response.json().catch(() => ({
            ok: false,
            description: `http ${response.status}`,
        }));

        if (!data.ok) {
            throw new TelegramError(method, data);
        }

        return data.result;
    }

    getUpdates(offset, timeout, signal) {
        return this.call("getUpdates", {
            offset,
            timeout,
            allowed_updates: ["message", "callback_query", "my_chat_member", "inline_query"],
        }, { signal });
    }

    sendMessage(chatId, text, extra = {}) {
        return this.call("sendMessage", {
            chat_id: chatId,
            text,
            link_preview_options: { is_disabled: true },
            ...extra,
        });
    }

    editMessageText(chatId, messageId, text, extra = {}) {
        return this.call("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text,
            link_preview_options: { is_disabled: true },
            ...extra,
        }, { key: `edit:${chatId}:${messageId}` });
    }

    answerCallbackQuery(id, text, showAlert = false) {
        return this.call("answerCallbackQuery", {
            callback_query_id: id,
            ...(text ? { text, show_alert: showAlert } : {}),
        });
    }

    // sends a copy of any message (text, media, ...), used for broadcasts
    copyMessage(chatId, fromChatId, messageId, extra = {}, { priority } = {}) {
        return this.call("copyMessage", {
            chat_id: chatId,
            from_chat_id: fromChatId,
            message_id: messageId,
            ...extra,
        }, { priority });
    }

    getChat(chatId) {
        return this.call("getChat", { chat_id: chatId });
    }

    getChatMember(chatId, userId) {
        return this.call("getChatMember", { chat_id: chatId, user_id: userId });
    }

    exportChatInviteLink(chatId) {
        return this.call("exportChatInviteLink", { chat_id: chatId });
    }

    deleteMessage(chatId, messageId) {
        return this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
    }

    sendChatAction(chatId, action) {
        return this.call("sendChatAction", { chat_id: chatId, action });
    }

    answerInlineQuery(id, results, extra = {}) {
        return this.call("answerInlineQuery", { inline_query_id: id, results, ...extra });
    }

    // sends a file: a local one (path) is uploaded, one that telegram
    // already has (fileId) is sent again without uploading.
    // e.g. sendFile("sendVideo", "video", chatId, { path, filename, type })
    async sendFile(method, field, chatId, file, extra = {}) {
        if (file.fileId) {
            return this.call(method, { chat_id: chatId, [field]: file.fileId, ...extra });
        }

        const form = new FormData();
        form.append("chat_id", String(chatId));

        for (const [key, value] of Object.entries(extra)) {
            if (value === undefined) continue;
            form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }

        const blob = await fs.openAsBlob(file.path, { type: file.type || "application/octet-stream" });
        form.append(field, blob, file.filename);

        return this.call(method, form);
    }

    // sends up to 10 photos and videos as one album, the caption goes under the first
    async sendMediaGroup(chatId, files, caption) {
        const media = files.map((file, i) => ({
            type: file.kind,
            media: file.fileId ?? `attach://file${i}`,
            ...(file.kind === "video" ? { supports_streaming: true } : {}),
            ...(i === 0 && caption ? { caption } : {}),
        }));

        if (files.every(file => file.fileId)) {
            return this.call("sendMediaGroup", { chat_id: chatId, media });
        }

        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("media", JSON.stringify(media));

        for (const [i, file] of files.entries()) {
            if (file.fileId) continue;
            const blob = await fs.openAsBlob(file.path, { type: file.type || "application/octet-stream" });
            form.append(`file${i}`, blob, file.filename);
        }

        return this.call("sendMediaGroup", form);
    }
}
