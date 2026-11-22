import fs from "node:fs";
import path from "node:path";

import { loadConfig } from "./config.js";
import { Telegram } from "./telegram.js";
import { FetchrClient } from "./fetchr.js";
import { Store } from "./store.js";
import { Bot } from "./bot.js";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const log = (...args) => console.log(new Date().toISOString(), ...args);

const config = loadConfig();
const telegram = new Telegram({ token: config.token, apiUrl: config.telegramApi });
const fetchr = new FetchrClient({ apiUrl: config.fetchrApi, apiKey: config.fetchrApiKey });

fs.mkdirSync(config.dataDir, { recursive: true });
const store = new Store(path.join(config.dataDir, "bot.db"));

// the api may still be starting
for (let attempt = 1; ; attempt++) {
    try {
        const info = await fetchr.init();
        log(`connected to fetchr ${info?.fetchr?.version ?? ""} at ${config.fetchrApi}`);
        break;
    } catch {
        log(`fetchr api isn't reachable at ${config.fetchrApi}, retrying (${attempt})`);
        await sleep(Math.min(30000, 2000 * attempt));
    }
}

// polling doesn't work while a webhook is set
await telegram.call("deleteWebhook").catch(() => {});

const commands = {
    en: [
        { command: "start", description: "start" },
        { command: "help", description: "how to use the bot" },
        { command: "settings", description: "default quality" },
        { command: "language", description: "change the language" },
        { command: "audio", description: "download just the audio: /audio link" },
    ],
    fa: [
        { command: "start", description: "شروع" },
        { command: "help", description: "راهنمای استفاده" },
        { command: "settings", description: "کیفیت پیش‌فرض" },
        { command: "language", description: "تغییر زبان" },
        { command: "audio", description: "دانلود فقط صدا: /audio لینک" },
    ],
};

await telegram.call("setMyCommands", { commands: commands.en }).catch(() => {});
await telegram.call("setMyCommands", { commands: commands.fa, language_code: "fa" }).catch(() => {});

// admins also see /admin in their menu
for (const adminId of config.adminIds) {
    const language = store.getUser(adminId)?.language === "en" ? "en" : "fa";
    await telegram.call("setMyCommands", {
        commands: [
            ...commands[language],
            { command: "admin", description: language === "fa" ? "پنل مدیریت" : "admin panel" },
        ],
        scope: { type: "chat", chat_id: adminId },
    }).catch(() => {});
}

const me = await telegram.call("getMe");
log(`bot @${me.username} is running, ${config.adminIds.size} admin(s)`);

const bot = new Bot({ config, telegram, fetchr, store });
const controller = new AbortController();
let running = true;

for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
        running = false;
        controller.abort();
    });
}

let offset = 0;
let failures = 0;

while (running) {
    try {
        const updates = await telegram.getUpdates(offset, 50, controller.signal);
        failures = 0;

        for (const update of updates) {
            offset = update.update_id + 1;
            // updates are handled in parallel, the bot limits concurrency itself.
            // nothing about users or their links is logged.
            bot.handleUpdate(update).catch(e => log(`couldn't handle an update: ${e.message}`));
        }
    } catch (e) {
        if (!running) break;

        failures++;
        const wait = e.retryAfter ? e.retryAfter * 1000 : Math.min(30000, 1000 * 2 ** failures);
        log(`polling failed: ${e.message}, retrying in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
    }
}

store.close();
log("stopped");
