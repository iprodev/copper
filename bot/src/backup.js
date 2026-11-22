// sends a copy of the bot's database to the admins

import fs from "node:fs";
import path from "node:path";

import { messages, format } from "./messages.js";

export const sendBackup = async ({ store, telegram, adminIds, dir }) => {
    const date = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `fetchr-bot-backup-${date}-${process.pid}-${Date.now()}.db`);

    store.backupTo(file);

    try {
        const users = store.stats().users;
        let sent = 0;

        for (const adminId of adminIds) {
            const t = messages(store.getUser(adminId)?.language ?? "fa");
            try {
                await telegram.sendFile("sendDocument", "document", adminId, {
                    path: file,
                    filename: `fetchr-bot-${date}.db`,
                    type: "application/vnd.sqlite3",
                }, {
                    caption: format(t.admin.backupCaption, { date, users }),
                });
                sent++;
            } catch {
                // an admin who never started the bot can't get messages
            }
        }

        return sent;
    } finally {
        await fs.promises.rm(file, { force: true });
    }
}

// runs fn every day at the given hour (server time)
export const daily = (hour, fn) => {
    let timer;

    const schedule = () => {
        const next = new Date();
        next.setHours(hour, 0, 0, 0);
        if (next <= new Date()) next.setDate(next.getDate() + 1);

        timer = setTimeout(async () => {
            try {
                await fn();
            } finally {
                schedule();
            }
        }, next - Date.now());
        timer.unref?.();
    };

    schedule();
    return () => clearTimeout(timer);
}
