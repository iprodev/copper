import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export class DownloadError extends Error {
    constructor(reason) {
        super(`download failed: ${reason}`);
        this.name = "DownloadError";
        this.reason = reason;
    }
}

const EXTENSIONS = {
    video: ["mp4", "webm", "mkv", "mov", "m4v"],
    audio: ["mp3", "ogg", "opus", "wav", "m4a", "aac", "flac"],
    photo: ["jpg", "jpeg", "png", "webp"],
    animation: ["gif"],
};

// "photo", "video", "audio", "animation" or "document"
export const mediaKind = (filename, contentType = "") => {
    const extension = path.extname(filename || "").slice(1).toLowerCase();
    for (const [kind, extensions] of Object.entries(EXTENSIONS)) {
        if (extensions.includes(extension)) return kind;
    }

    if (contentType.startsWith("image/gif")) return "animation";
    for (const kind of ["video", "audio"]) {
        if (contentType.startsWith(`${kind}/`)) return kind;
    }
    if (contentType.startsWith("image/")) return "photo";

    return "document";
}

export const filenameFrom = (disposition) => {
    if (!disposition) return;

    const encoded = disposition.match(/filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]+)/);
    if (encoded) {
        try {
            return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
        } catch {}
    }

    const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/);
    return plain?.[1]?.trim();
}

const safeName = (name) =>
    // no path separators or control characters in names sent to telegram
    String(name).replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200);

const extensionFor = (contentType = "") => {
    const type = contentType.split(";")[0].trim();
    return {
        "video/mp4": "mp4", "video/webm": "webm", "audio/mpeg": "mp3",
        "audio/ogg": "ogg", "audio/opus": "opus", "audio/wav": "wav",
        "audio/mp4": "m4a", "image/jpeg": "jpg", "image/png": "png",
        "image/webp": "webp", "image/gif": "gif",
    }[type];
}

// downloads a url into a temporary file, refusing files over maxSize bytes
export const downloadToFile = async (url, { dir, maxSize, fetch = globalThis.fetch, filename, signal }) => {
    let response;
    try {
        response = await fetch(url, { redirect: "follow", signal });
    } catch {
        throw new DownloadError("network");
    }

    if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new DownloadError(`status ${response.status}`);
    }

    const declared = Number(response.headers.get("content-length"));
    const estimated = Number(response.headers.get("estimated-content-length"));
    // the estimate of a tunnel can be a bit off, so it gets some room
    if (declared > maxSize || estimated > maxSize * 1.1) {
        await response.body.cancel().catch(() => {});
        throw new DownloadError("too_big");
    }

    const contentType = response.headers.get("content-type") || "";
    let name = filename || filenameFrom(response.headers.get("content-disposition"));
    if (!name) {
        const fromUrl = path.basename(new URL(response.url || url).pathname);
        name = path.extname(fromUrl) ? fromUrl : `file.${extensionFor(contentType) || "bin"}`;
    }

    const file = path.join(dir, `fetchr-bot-${crypto.randomUUID()}`);
    let size = 0;

    const limit = new Transform({
        transform(chunk, _, callback) {
            size += chunk.length;
            if (size > maxSize) {
                return callback(new DownloadError("too_big"));
            }
            callback(null, chunk);
        }
    });

    try {
        await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(file));
    } catch (e) {
        await fs.promises.rm(file, { force: true });
        throw e instanceof DownloadError ? e : new DownloadError("network");
    }

    if (size === 0) {
        await fs.promises.rm(file, { force: true });
        throw new DownloadError("empty");
    }

    return {
        path: file,
        size,
        filename: safeName(name),
        type: contentType.split(";")[0].trim() || undefined,
    };
}
