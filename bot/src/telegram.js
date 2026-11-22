import fs from "node:fs";

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

    constructor({ token, apiUrl = "https://api.telegram.org", fetch = globalThis.fetch }) {
        this.#base = `${apiUrl}/bot${token}`;
        this.#fetch = fetch;
    }

    async call(method, params = {}, { signal } = {}) {
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
            allowed_updates: ["message"],
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

    editMessageText(chatId, messageId, text) {
        return this.call("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text,
            link_preview_options: { is_disabled: true },
        });
    }

    deleteMessage(chatId, messageId) {
        return this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
    }

    sendChatAction(chatId, action) {
        return this.call("sendChatAction", { chat_id: chatId, action });
    }

    // uploads a local file, e.g. sendFile("sendVideo", "video", ...)
    async sendFile(method, field, chatId, file, extra = {}) {
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

    // sends up to 10 photos and videos as one album
    async sendMediaGroup(chatId, files) {
        const form = new FormData();
        form.append("chat_id", String(chatId));
        form.append("media", JSON.stringify(files.map((file, i) => ({
            type: file.kind,
            media: `attach://file${i}`,
            ...(file.kind === "video" ? { supports_streaming: true } : {}),
        }))));

        for (const [i, file] of files.entries()) {
            const blob = await fs.openAsBlob(file.path, { type: file.type || "application/octet-stream" });
            form.append(`file${i}`, blob, file.filename);
        }

        return this.call("sendMediaGroup", form);
    }
}
