// admin panel: stats, broadcasts, required channels, welcome message,
// banning users and maintenance mode. only for ADMIN_IDS.

import { format, LANGUAGES } from "./messages.js";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// telegram allows about 30 messages per second, broadcasts stay below that
const BROADCAST_DELAY = 40;

const button = (text, data) => ({ text, callback_data: data });

export class Admin {
    #telegram;
    #store;
    #botId;
    #isAdmin;
    // what an admin is asked for: { type, ... }
    #pending = new Map();
    #broadcasting = false;

    constructor({ telegram, store, botId, isAdmin }) {
        this.#telegram = telegram;
        this.#store = store;
        this.#botId = botId;
        this.#isAdmin = isAdmin;
    }

    get broadcasting() {
        return this.#broadcasting;
    }

    isWaiting(adminId) {
        return this.#pending.has(adminId);
    }

    cancel(adminId) {
        this.#pending.delete(adminId);
    }

    #menu(t) {
        const maintenance = this.#store.getSetting("maintenance", false);
        return {
            inline_keyboard: [
                [button(t.admin.stats, "a:stats"), button(t.admin.broadcast, "a:bc")],
                [button(t.admin.channels, "a:ch"), button(t.admin.welcome, "a:wl")],
                [
                    button(t.admin.users, "a:ban"),
                    button(maintenance ? t.admin.maintenanceOn : t.admin.maintenanceOff, "a:mt"),
                ],
            ],
        };
    }

    #backButton(t) {
        return { inline_keyboard: [[button(t.admin.back, "a:menu")]] };
    }

    #cancelButton(t) {
        return { inline_keyboard: [[button(t.admin.cancel, "a:x")]] };
    }

    showMenu(chatId, t) {
        this.#pending.delete(chatId);
        return this.#telegram.sendMessage(chatId, t.admin.title, { reply_markup: this.#menu(t) });
    }

    #edit(query, text, markup) {
        return this.#telegram.editMessageText(
            query.message.chat.id, query.message.message_id, text,
            markup ? { reply_markup: markup } : {}
        ).catch(() => {});
    }

    #statsText(t) {
        const stats = this.#store.stats();
        const top = stats.topServices.length
            ? stats.topServices.map(({ service, count }) => `• ${service}: ${count}`).join("\n")
            : t.admin.none;
        return format(t.admin.statsText, { ...stats, top });
    }

    #channelsView(t) {
        const channels = this.#store.getSetting("channels", []);
        const list = channels.length
            ? channels.map(channel => `• ${channel.title} (${channel.link})`).join("\n")
            : t.admin.channelsEmpty;

        return {
            text: format(t.admin.channelsText, { list }),
            markup: {
                inline_keyboard: [
                    ...channels.map((channel, i) => [
                        button(format(t.admin.channelRemove, { title: channel.title }), `a:ch:rm:${i}`),
                    ]),
                    [button(t.admin.channelAdd, "a:ch:add")],
                    [button(t.admin.back, "a:menu")],
                ],
            },
        };
    }

    #welcomeView(t) {
        const current = (language) =>
            this.#store.getSetting(`welcome.${language}`) ?? `${t.admin.welcomeDefault} ${LANGUAGES[language].welcome}`;

        return {
            text: format(t.admin.welcomeText, { fa: current("fa"), en: current("en") }),
            markup: {
                inline_keyboard: [
                    [button(t.admin.welcomeEditFa, "a:wl:fa"), button(t.admin.welcomeEditEn, "a:wl:en")],
                    [button(t.admin.welcomeReset, "a:wl:reset")],
                    [button(t.admin.back, "a:menu")],
                ],
            },
        };
    }

    async handleCallback(query, t) {
        const adminId = query.from.id;
        const [ , action, ...args ] = query.data.split(":");

        await this.#telegram.answerCallbackQuery(query.id).catch(() => {});
        if (!query.message) return;

        switch (action) {
            case "menu":
                this.#pending.delete(adminId);
                return this.#edit(query, t.admin.title, this.#menu(t));

            case "x":
                this.#pending.delete(adminId);
                return this.#edit(query, t.admin.canceled, this.#backButton(t));

            case "stats":
                return this.#edit(query, this.#statsText(t), this.#backButton(t));

            case "mt": {
                const maintenance = !this.#store.getSetting("maintenance", false);
                this.#store.setSetting("maintenance", maintenance);
                return this.#edit(
                    query,
                    `${t.admin.title}\n\n${format(t.admin.maintenanceToggled, { state: maintenance ? t.admin.on : t.admin.off })}`,
                    this.#menu(t),
                );
            }

            case "ban":
                this.#pending.set(adminId, { type: "ban" });
                return this.#edit(query, t.admin.usersPrompt, this.#cancelButton(t));

            case "wl": {
                if (args[0] === "fa" || args[0] === "en") {
                    this.#pending.set(adminId, { type: "welcome", language: args[0] });
                    return this.#edit(query, t.admin.welcomePrompt, this.#cancelButton(t));
                }
                if (args[0] === "reset") {
                    this.#store.setSetting("welcome.fa", null);
                    this.#store.setSetting("welcome.en", null);
                }
                const { text, markup } = this.#welcomeView(t);
                return this.#edit(query, text, markup);
            }

            case "ch": {
                if (args[0] === "add") {
                    this.#pending.set(adminId, { type: "channel" });
                    return this.#edit(query, t.admin.channelPrompt, this.#cancelButton(t));
                }
                if (args[0] === "rm") {
                    const channels = this.#store.getSetting("channels", []);
                    channels.splice(Number(args[1]), 1);
                    this.#store.setSetting("channels", channels);
                }
                const { text, markup } = this.#channelsView(t);
                return this.#edit(query, text, markup);
            }

            case "bc": {
                if (args[0] === "go") {
                    const pending = this.#pending.get(adminId);
                    this.#pending.delete(adminId);
                    if (pending?.type !== "broadcast-confirm") {
                        return this.#edit(query, t.admin.canceled, this.#backButton(t));
                    }
                    if (this.#broadcasting) {
                        return this.#edit(query, t.admin.broadcastBusy, this.#backButton(t));
                    }
                    // runs in the background, the progress message is updated
                    this.#broadcast(query.message.chat.id, query.message.message_id, pending, t)
                        .catch(() => { this.#broadcasting = false; });
                    return;
                }

                if (this.#broadcasting) {
                    return this.#edit(query, t.admin.broadcastBusy, this.#backButton(t));
                }
                this.#pending.set(adminId, { type: "broadcast" });
                return this.#edit(query, t.admin.broadcastPrompt, this.#cancelButton(t));
            }
        }
    }

    // a message from an admin who was asked for something
    async handleInput(message, t) {
        const adminId = message.from.id;
        const chatId = message.chat.id;
        const pending = this.#pending.get(adminId);
        const reply = (text, markup) => this.#telegram.sendMessage(chatId, text, markup ? { reply_markup: markup } : {});

        switch (pending?.type) {
            case "broadcast": {
                // the confirmation shows a copy of the message, exactly as users will get it
                this.#pending.set(adminId, {
                    type: "broadcast-confirm",
                    fromChatId: chatId,
                    messageId: message.message_id,
                });
                await this.#telegram.copyMessage(chatId, chatId, message.message_id).catch(() => {});
                return reply(
                    format(t.admin.broadcastConfirm, { count: this.#store.broadcastTargets().length }),
                    { inline_keyboard: [[button(t.admin.broadcastSend, "a:bc:go"), button(t.admin.cancel, "a:x")]] },
                );
            }

            case "welcome": {
                const text = message.text?.trim();
                if (!text) return reply(t.admin.welcomePrompt, this.#cancelButton(t));

                this.#pending.delete(adminId);
                this.#store.setSetting(`welcome.${pending.language}`, text);
                const view = this.#welcomeView(t);
                return reply(`${t.admin.welcomeSaved}\n\n${view.text}`, view.markup);
            }

            case "ban": {
                const match = message.text?.trim().match(/^(-?)(\d+)$/);
                if (!match) return reply(t.admin.userInvalid, this.#cancelButton(t));

                const [ , unban, id ] = match;
                const userId = Number(id);
                if (this.#isAdmin(userId)) {
                    this.#pending.delete(adminId);
                    return reply(t.admin.userIsAdmin, this.#backButton(t));
                }
                if (!this.#store.setBanned(userId, !unban)) {
                    return reply(t.admin.userNotFound, this.#cancelButton(t));
                }

                this.#pending.delete(adminId);
                return reply(format(unban ? t.admin.userUnbanned : t.admin.userBanned, { id: userId }), this.#backButton(t));
            }

            case "channel": {
                const result = await this.#addChannel(message, t);
                if (result.error) return reply(result.error, this.#cancelButton(t));

                this.#pending.delete(adminId);
                const view = this.#channelsView(t);
                return reply(`${format(t.admin.channelAdded, { title: result.title })}\n\n${view.text}`, view.markup);
            }
        }
    }

    async #addChannel(message, t) {
        // a forwarded post, a username, a t.me link or a numeric id
        let target = message.forward_origin?.chat?.id ?? message.forward_from_chat?.id;
        if (!target) {
            const text = message.text?.trim() ?? "";
            const username = text.match(/^(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{4,})\/?$/)?.[1]
                ?? text.match(/^@([A-Za-z0-9_]{4,})$/)?.[1];
            target = username ? `@${username}` : (/^-100\d+$/.test(text) ? Number(text) : undefined);
        }
        if (!target) return { error: t.admin.channelNotFound };

        let chat;
        try {
            chat = await this.#telegram.getChat(target);
        } catch {
            return { error: t.admin.channelNotFound };
        }

        try {
            const member = await this.#telegram.getChatMember(chat.id, this.#botId);
            if (!["administrator", "creator"].includes(member.status)) {
                return { error: t.admin.channelNotAdmin };
            }
        } catch {
            return { error: t.admin.channelNotAdmin };
        }

        let link = chat.username ? `https://t.me/${chat.username}` : chat.invite_link;
        if (!link) {
            link = await this.#telegram.exportChatInviteLink(chat.id).catch(() => undefined);
        }
        if (!link) return { error: t.admin.channelNoLink };

        const title = chat.title || chat.username || String(chat.id);
        const channels = this.#store.getSetting("channels", []).filter(channel => channel.id !== chat.id);
        channels.push({ id: chat.id, title, link });
        this.#store.setSetting("channels", channels);

        return { title };
    }

    async #broadcast(chatId, progressMessageId, { fromChatId, messageId }, t) {
        this.#broadcasting = true;

        const targets = this.#store.broadcastTargets();
        let sent = 0, blocked = 0, failed = 0, lastUpdate = 0;

        const progress = (done) => this.#telegram.editMessageText(
            chatId, progressMessageId,
            format(t.admin.broadcastRunning, { done, total: targets.length }),
        ).catch(() => {});

        await progress(0);

        for (const [i, userId] of targets.entries()) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await this.#telegram.copyMessage(userId, fromChatId, messageId);
                    sent++;
                    break;
                } catch (e) {
                    if (e.code === 429 && e.retryAfter) {
                        await sleep(e.retryAfter * 1000);
                        continue;
                    }
                    if (e.code === 403) {
                        // the user blocked the bot or deleted their account
                        this.#store.setBlocked(userId, true);
                        blocked++;
                    } else {
                        failed++;
                    }
                    break;
                }
            }

            if (Date.now() - lastUpdate > 3000) {
                lastUpdate = Date.now();
                await progress(i + 1);
            }
            await sleep(BROADCAST_DELAY);
        }

        this.#broadcasting = false;

        await this.#telegram.editMessageText(
            chatId, progressMessageId,
            format(t.admin.broadcastDone, { sent, blocked, failed }),
            { reply_markup: this.#backButton(t) },
        ).catch(() => {});

        return { sent, blocked, failed };
    }
}
