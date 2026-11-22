// generic extractor: finds media on any web page, not just supported services.
// it's disabled by default (ENABLE_GENERIC_EXTRACTOR=1 enables it), because it
// makes the server request arbitrary urls. every url is checked with the ssrf
// guard in security/network.js, including redirects, hls playlists and segments.

import HLS from "hls-parser";

import { env, genericUserAgent } from "../../config.js";
import { sanitizeString } from "../create-filename.js";
import { safeFetch, readLimitedText, UnsafeURLError } from "../../security/network.js";

const PAGE_SIZE_LIMIT = 5 * 1024 * 1024; // 5 MB
const PLAYLIST_SIZE_LIMIT = 1024 * 1024; // 1 MB
const REQUEST_TIMEOUT = 10000;

const VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v"];
const AUDIO_EXTENSIONS = ["mp3", "m4a", "ogg", "opus", "wav"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp"];
const HLS_EXTENSIONS = ["m3u8"];

const HLS_TYPES = ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl"];

const headers = {
    "user-agent": genericUserAgent,
    "accept": "text/html,application/xhtml+xml,*/*;q=0.8",
};

const extensionOf = (url) => {
    try {
        return new URL(url).pathname.split(".").pop().toLowerCase();
    } catch {}
}

const kindOf = (url, type = "") => {
    const ext = extensionOf(url);
    type = type.toLowerCase();

    if (HLS_EXTENSIONS.includes(ext) || HLS_TYPES.some(t => type.includes(t))) return "hls";
    if (VIDEO_EXTENSIONS.includes(ext) || type.startsWith("video/")) return "video";
    if (AUDIO_EXTENSIONS.includes(ext) || type.startsWith("audio/")) return "audio";
    if (IMAGE_EXTENSIONS.includes(ext) || type.startsWith("image/")) return "image";
}

const decodeHTML = (text) => text
    ?.replace(/&amp;/g, "&")
    ?.replace(/&quot;/g, '"')
    ?.replace(/&#0?39;|&apos;/g, "'")
    ?.replace(/&lt;/g, "<")
    ?.replace(/&gt;/g, ">")
    ?.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    ?.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

const attr = (tag, name) => {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value !== undefined ? decodeHTML(value) : undefined;
}

const metaContent = (html, ...names) => {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
        const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
        if (names.includes(key)) {
            const content = attr(tag, "content");
            if (content) return content;
        }
    }
}

const metaContents = (html, name) => {
    const values = [];
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
        const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
        if (key === name) values.push(attr(tag, "content"));
    }
    return values;
}

const absolute = (url, base) => {
    try {
        const resolved = new URL(url, base);
        if (resolved.protocol === "http:" || resolved.protocol === "https:") {
            return resolved.toString();
        }
    } catch {}
}

const fromJsonLd = (html) => {
    const found = [];

    const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);

        const types = [node["@type"]].flat();
        if (types.includes("VideoObject") && node.contentUrl) {
            found.push({ url: node.contentUrl, source: "json-ld", type: node.encodingFormat });
        }
        if (types.includes("AudioObject") && node.contentUrl) {
            found.push({ url: node.contentUrl, source: "json-ld", type: node.encodingFormat || "audio/" });
        }

        Object.values(node).forEach(walk);
    }

    for (const [, json] of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis)) {
        try {
            walk(JSON.parse(json));
        } catch {}
    }

    return found;
}

const fromMeta = (html) => {
    const found = [];
    const ogVideoType = metaContent(html, "og:video:type");

    // skip players embedded as web pages (e.g. youtube embeds)
    if (!ogVideoType || !/text\/html|shockwave/i.test(ogVideoType)) {
        for (const name of ["og:video:secure_url", "og:video:url", "og:video"]) {
            for (const url of metaContents(html, name)) {
                if (url) found.push({ url, source: "meta", type: ogVideoType });
            }
        }
    }

    const stream = metaContent(html, "twitter:player:stream");
    if (stream) {
        found.push({ url: stream, source: "meta", type: metaContent(html, "twitter:player:stream:content_type") });
    }

    const audio = metaContent(html, "og:audio:secure_url", "og:audio:url", "og:audio");
    if (audio) {
        found.push({ url: audio, source: "meta", type: metaContent(html, "og:audio:type") || "audio/" });
    }

    return found;
}

const fromTags = (html) => {
    const found = [];

    for (const [, kind, inner] of html.matchAll(/<(video|audio)\b([^>]*)>/gi)) {
        const src = attr(inner, "src");
        if (src) found.push({ url: src, source: "tag", type: kind === "audio" ? "audio/" : attr(inner, "type") });
    }

    for (const [tag] of html.matchAll(/<source\b[^>]*>/gi)) {
        const src = attr(tag, "src");
        if (src) found.push({ url: src, source: "tag", type: attr(tag, "type") });
    }

    return found;
}

// direct links to media files anywhere in the page, including escaped json
const fromLinks = (html) => {
    const unescaped = html.replace(/\\\//g, "/").replace(/\\u002[fF]/g, "/");
    const regex = /https?:\/\/[^\s"'<>()\\]+?\.(?:mp4|webm|mov|m4v|m3u8|mp3|m4a)(?:\?[^\s"'<>()\\]*)?(?=["'\s<>()\\]|$)/gi;
    return [...unescaped.matchAll(regex)].map(([url]) => ({ url: decodeHTML(url), source: "link" }));
}

const KIND_PRIORITY = { video: 0, hls: 1, audio: 2 };
const SOURCE_PRIORITY = { "json-ld": 0, meta: 1, tag: 2, link: 3 };

// returns media candidates found in a page, best first
export function findMedia(html, baseUrl) {
    const seen = new Set();

    const candidates = [...fromJsonLd(html), ...fromMeta(html), ...fromTags(html), ...fromLinks(html)]
        .map(c => ({ ...c, url: absolute(c.url, baseUrl) }))
        .filter(c => c.url && !seen.has(c.url) && seen.add(c.url))
        .map(c => ({ ...c, kind: kindOf(c.url, c.type ?? "") }))
        .filter(c => c.kind in KIND_PRIORITY);

    candidates.sort((a, b) =>
        KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
        || SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
    );

    return candidates;
}

export function findTitle(html) {
    const title = metaContent(html, "og:title", "twitter:title")
               || decodeHTML(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);

    return title?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
}

export function findImage(html, baseUrl) {
    const image = metaContent(html, "og:image:secure_url", "og:image", "twitter:image");
    return image && absolute(image, baseUrl);
}

const timeout = () => AbortSignal.timeout(REQUEST_TIMEOUT);

const pickVariant = (variants, quality) => {
    const sorted = variants
        .filter(v => v.uri)
        .sort((a, b) => Number(b.bandwidth) - Number(a.bandwidth));

    if (!quality || quality === "max") return sorted[0];

    // variants without a resolution can't be compared, so the best one is used
    const shortSide = v => v.resolution && Math.min(v.resolution.width, v.resolution.height);
    return sorted.find(v => shortSide(v) && shortSide(v) <= Number(quality))
        ?? sorted.find(v => !shortSide(v))
        ?? sorted[sorted.length - 1];
}

// checks an hls playlist (following a master playlist to the variant that
// matches the preferred quality) against the duration limit
const checkPlaylist = async (url, quality) => {
    const { response, url: finalUrl } = await safeFetch(url, { headers, signal: timeout() });
    if (response.status !== 200) return { error: "fetch.fail" };

    let playlist;
    try {
        playlist = HLS.parse(await readLimitedText(response, PLAYLIST_SIZE_LIMIT));
    } catch {
        return { error: "fetch.empty" };
    }

    if (playlist.isMasterPlaylist) {
        const variant = pickVariant(playlist.variants ?? [], quality);

        if (!variant) return { error: "fetch.empty" };
        return checkPlaylist(new URL(variant.uri, finalUrl).toString());
    }

    if (!playlist.endlist) return { error: "content.video.live" };

    const duration = playlist.segments?.reduce((total, s) => total + (s.duration || 0), 0) ?? 0;
    if (duration > env.durationLimit) return { error: "content.too_long" };
    if (!playlist.segments?.length) return { error: "fetch.empty" };

    return { url: finalUrl };
}

// checks a media url and resolves its redirects, so tunnels never follow them
const resolveMedia = async (url) => {
    const { response, url: finalUrl } = await safeFetch(url, {
        headers: { ...headers, range: "bytes=0-0" },
        signal: timeout(),
    });
    await response.body?.cancel().catch(() => {});

    if (response.status !== 200 && response.status !== 206) return;
    return { url: finalUrl, type: response.headers.get("content-type") ?? "" };
}

const filenameFor = (title, host, ext) => {
    const base = sanitizeString(title || host).slice(0, 100) || "media";
    return ext ? `${base}.${ext}` : base;
}

const mediaResult = async (candidate, title, host, quality) => {
    if (candidate.kind === "hls") {
        const checked = await checkPlaylist(candidate.url, quality);
        if (checked.error) return checked;

        return {
            urls: checked.url,
            isHLS: true,
            filename: filenameFor(title, host, "mp4"),
            audioFilename: filenameFor(title, host),
            fileMetadata: { title },
        }
    }

    const media = await resolveMedia(candidate.url);
    if (!media) return;

    if (kindOf(media.url, media.type) === "hls") {
        return mediaResult({ ...candidate, url: media.url, kind: "hls" }, title, host, quality);
    }

    const ext = extensionOf(media.url);
    if (candidate.kind === "audio") {
        return {
            urls: media.url,
            isAudioOnly: true,
            bestAudio: AUDIO_EXTENSIONS.includes(ext) ? ext : undefined,
            filename: filenameFor(title, host, AUDIO_EXTENSIONS.includes(ext) ? ext : "mp3"),
            audioFilename: filenameFor(title, host),
            fileMetadata: { title },
        }
    }

    return {
        urls: media.url,
        filename: filenameFor(title, host, VIDEO_EXTENSIONS.includes(ext) ? ext : "mp4"),
        audioFilename: filenameFor(title, host),
        fileMetadata: { title },
    }
}

export default async function({ url, quality }) {
    const pageUrl = String(url);
    const host = new URL(pageUrl).hostname.replace(/^www\./, "");

    let response, finalUrl;
    try {
        ({ response, url: finalUrl } = await safeFetch(pageUrl, { headers, signal: timeout() }));
    } catch (e) {
        if (e instanceof UnsafeURLError) return { error: "link.invalid" };
        return { error: "fetch.fail" };
    }

    if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return { error: "fetch.fail" };
    }

    const type = response.headers.get("content-type") ?? "";

    try {
        // the link points to a media file itself
        const directKind = kindOf(finalUrl, type);
        if (directKind && !type.includes("text/html")) {
            await response.body?.cancel().catch(() => {});

            if (directKind === "image") return {
                urls: finalUrl,
                isPhoto: true,
                filename: filenameFor(undefined, host, extensionOf(finalUrl) || "jpg"),
            }

            return await mediaResult({ url: finalUrl, kind: directKind }, undefined, host, quality)
                ?? { error: "fetch.empty" };
        }

        if (!type.includes("html")) {
            await response.body?.cancel().catch(() => {});
            return { error: "fetch.empty" };
        }

        const html = await readLimitedText(response, PAGE_SIZE_LIMIT);
        const title = findTitle(html);

        for (const candidate of findMedia(html, finalUrl).slice(0, 5)) {
            try {
                const result = await mediaResult(candidate, title, host, quality);
                if (result) return result;
            } catch (e) {
                if (!(e instanceof UnsafeURLError)) throw e;
            }
        }

        // pages without a video or audio file: fall back to the main image
        const image = findImage(html, finalUrl);
        if (image) {
            const media = await resolveMedia(image).catch(() => {});
            if (media && kindOf(media.url, media.type) === "image") return {
                urls: media.url,
                isPhoto: true,
                filename: filenameFor(title, host, extensionOf(media.url) || "jpg"),
            }
        }
    } catch (e) {
        if (e instanceof UnsafeURLError) return { error: "link.invalid" };
        return { error: "fetch.fail" };
    }

    return { error: "fetch.empty" };
}
