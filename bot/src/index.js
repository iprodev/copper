import { loadConfig } from "./config.js";
import { Telegram } from "./telegram.js";
import { FetchrClient } from "./fetchr.js";
import { Bot } from "./bot.js";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const log = (...args) => console.log(new Date().toISOString(), ...args);

const config = loadConfig();
const telegram = new Telegram({ token: config.token, apiUrl: config.telegramApi });
const fetchr = new FetchrClient({ apiUrl: config.fetchrApi, apiKey: config.fetchrApiKey });

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

await telegram.call("setMyCommands", {
    commands: [
        { command: "start", description: "how to use the bot" },
        { command: "audio", description: "download just the audio: /audio link" },
    ],
}).catch(() => {});

await telegram.call("setMyCommands", {
    language_code: "fa",
    commands: [
        { command: "start", description: "راهنمای استفاده" },
        { command: "audio", description: "دانلود فقط صدا: /audio لینک" },
    ],
}).catch(() => {});

const me = await telegram.call("getMe");
log(`bot @${me.username} is running`);

const bot = new Bot({ config, telegram, fetchr });
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
            // messages are handled in parallel, the bot limits concurrency itself.
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

log("stopped");
