import os from "node:os";

const QUALITIES = ["max", "4320", "2160", "1440", "1080", "720", "480", "360", "240", "144"];

const positive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

export const loadConfig = (env = process.env) => {
    const token = env.BOT_TOKEN?.trim();
    if (!token) {
        throw new Error("BOT_TOKEN is required");
    }

    // a local bot api server (github.com/tdlib/telegram-bot-api) allows
    // uploads up to 2000 MB, telegram's own api only up to 50 MB
    const localBotApi = !!env.TELEGRAM_API_URL;
    const telegramApi = (env.TELEGRAM_API_URL || "https://api.telegram.org").replace(/\/+$/, "");

    const videoQuality = env.VIDEO_QUALITY || "720";
    if (!QUALITIES.includes(videoQuality)) {
        throw new Error(`VIDEO_QUALITY must be one of: ${QUALITIES.join(", ")}`);
    }

    const idList = (value) => new Set(
        String(value ?? "").split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isSafeInteger)
    );

    return {
        token,
        telegramApi,
        fetchrApi: new URL(env.FETCHR_API_URL || "http://localhost:9000/").toString(),
        fetchrApiKey: env.FETCHR_API_KEY || undefined,
        maxFileSize: positive(env.MAX_FILE_SIZE_MB, localBotApi ? 2000 : 50) * 1024 * 1024,
        videoQuality,
        concurrency: positive(env.CONCURRENCY, 3),
        userRateLimit: positive(env.USER_RATE_LIMIT, 10),
        // users that can open the admin panel (/admin)
        adminIds: idList(env.ADMIN_IDS),
        // where the database is kept
        dataDir: env.DATA_DIR || "data",
        tempDir: env.TEMP_DIR || os.tmpdir(),
    };
}
