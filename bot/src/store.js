// users, settings and download counts of the bot, in sqlite.
// only what the bot needs is stored: telegram id, language and settings of
// users (for broadcasts), and the number of downloads per service per day.
// links are never stored.

import { DatabaseSync } from "node:sqlite";

const today = () => new Date().toISOString().slice(0, 10);

const daysAgo = (days) =>
    new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

export class Store {
    #db;

    constructor(path = ":memory:") {
        this.#db = new DatabaseSync(path);
        this.#db.exec(`
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                language TEXT,
                quality TEXT NOT NULL DEFAULT 'ask',
                joined_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                -- the user blocked the bot, broadcasts skip them
                blocked INTEGER NOT NULL DEFAULT 0,
                -- an admin banned the user
                banned INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS downloads (
                day TEXT NOT NULL,
                service TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, service)
            );
        `);
    }

    // returns the user, creating it on first contact
    touchUser(id) {
        const now = Date.now();
        const existing = this.getUser(id);

        if (existing) {
            this.#db.prepare("UPDATE users SET last_seen = ?, blocked = 0 WHERE id = ?").run(now, id);
            return { user: { ...existing, blocked: 0 }, isNew: false };
        }

        this.#db.prepare("INSERT INTO users (id, joined_at, last_seen) VALUES (?, ?, ?)").run(id, now, now);
        return { user: this.getUser(id), isNew: true };
    }

    getUser(id) {
        const row = this.#db.prepare("SELECT * FROM users WHERE id = ?").get(id);
        return row ? { ...row } : undefined;
    }

    setLanguage(id, language) {
        this.#db.prepare("UPDATE users SET language = ? WHERE id = ?").run(language, id);
    }

    setQuality(id, quality) {
        this.#db.prepare("UPDATE users SET quality = ? WHERE id = ?").run(quality, id);
    }

    setBlocked(id, blocked) {
        this.#db.prepare("UPDATE users SET blocked = ? WHERE id = ?").run(blocked ? 1 : 0, id);
    }

    // returns false if the user has never used the bot
    setBanned(id, banned) {
        const result = this.#db.prepare("UPDATE users SET banned = ? WHERE id = ?").run(banned ? 1 : 0, id);
        return result.changes > 0;
    }

    // users that can receive broadcasts
    broadcastTargets() {
        return this.#db.prepare("SELECT id FROM users WHERE blocked = 0 AND banned = 0 ORDER BY id")
            .all().map(row => row.id);
    }

    countDownload(service) {
        this.#db.prepare(`
            INSERT INTO downloads (day, service, count) VALUES (?, ?, 1)
            ON CONFLICT (day, service) DO UPDATE SET count = count + 1
        `).run(today(), service || "other");
    }

    stats() {
        const one = (sql, ...params) => Number(this.#db.prepare(sql).get(...params).n);
        const dayStart = new Date(today()).getTime();

        return {
            users: one("SELECT count(*) n FROM users"),
            active: one("SELECT count(*) n FROM users WHERE blocked = 0 AND banned = 0"),
            blocked: one("SELECT count(*) n FROM users WHERE blocked = 1"),
            banned: one("SELECT count(*) n FROM users WHERE banned = 1"),
            newToday: one("SELECT count(*) n FROM users WHERE joined_at >= ?", dayStart),
            newWeek: one("SELECT count(*) n FROM users WHERE joined_at >= ?", dayStart - 6 * 86400000),
            activeToday: one("SELECT count(*) n FROM users WHERE last_seen >= ?", dayStart),
            downloadsToday: one("SELECT coalesce(sum(count), 0) n FROM downloads WHERE day = ?", today()),
            downloadsWeek: one("SELECT coalesce(sum(count), 0) n FROM downloads WHERE day >= ?", daysAgo(6)),
            downloadsTotal: one("SELECT coalesce(sum(count), 0) n FROM downloads"),
            topServices: this.#db.prepare(`
                SELECT service, sum(count) count FROM downloads WHERE day >= ?
                GROUP BY service ORDER BY count DESC LIMIT 5
            `).all(daysAgo(6)).map(row => ({ service: row.service, count: Number(row.count) })),
        };
    }

    getSetting(key, fallback) {
        const row = this.#db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
        return row ? JSON.parse(row.value) : fallback;
    }

    setSetting(key, value) {
        if (value === undefined || value === null) {
            this.#db.prepare("DELETE FROM settings WHERE key = ?").run(key);
            return;
        }

        this.#db.prepare(`
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value
        `).run(key, JSON.stringify(value));
    }

    close() {
        this.#db.close();
    }
}
