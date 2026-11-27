// links looked up with yt-dlp: from sites fetchr doesn't support itself, and
// links of fetchr's services when the service itself fails (YTDLP_FALLBACK).
// yt-dlp runs in its own container (see /ytdlp and YTDLP_URL) and only says
// where a link's files are; they're downloaded through fetchr's own tunnels,
// as untrusted ("generic") urls: every address is checked, redirects too.
// files of a service's link go the way the service's requests go (e.g.
// through warp for youtube), since files may only work for that address.

import { Agent, request } from "undici";

import { env } from "../../config.js";
import { createStream } from "../../stream/manage.js";
import { sanitizeString } from "../create-filename.js";
import { assertSafeURL, getSafeDispatcher, readLimitedText, MAX_REDIRECTS } from "../../security/network.js";

// the yt-dlp container is asked directly, never through a service's proxy
const agent = new Agent();

// yt-dlp's own limit is 30 seconds, plus up to 10 waiting for a free worker
const LOOKUP_TIMEOUT = 45000;
const CHECK_TIMEOUT = 10000;
const PLAYLIST_SIZE_LIMIT = 1024 * 1024;
const PICKER_ITEMS = 10;

const DIRECT = new Set(["https", "http"]);
const HLS = new Set(["m3u8", "m3u8_native"]);

const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba", "mka"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);
// files that play everywhere. others (avi, flv, ogv...) are only used
// when there's nothing else
const COMMON_VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
// audio fetchr can send as it is, when "best" audio is asked for
const KEPT_AUDIO = new Set(["mp3", "m4a", "opus", "ogg", "wav"]);

// headers of yt-dlp's that are sent along with the file requests
const PASSED_HEADERS = new Set(["user-agent", "referer", "origin", "accept-language"]);

// the service tells the container which proxy to use (the same as SERVICE_PROXIES)
export const askYtdlp = async (url, service = "generic") => {
    const response = await request(new URL("extract", env.ytdlpURL), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, service }),
        dispatcher: agent,
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT),
    });

    if (response.statusCode !== 200) {
        await response.body.dump();
        return { ok: false, error: "fetch.fail" };
    }

    return response.body.json();
}

const protocolOf = (f) => {
    if (f.protocol) return f.protocol;
    try {
        return new URL(f.url).pathname.endsWith(".m3u8") ? "m3u8" : "https";
    } catch {}
}

const isHLS = (f) => HLS.has(protocolOf(f));

// what a format is: "both" (video with sound), "video", "audio" or "image".
// codecs yt-dlp doesn't know (null) are guessed from the file's extension
export const kindOf = (f) => {
    if (!f?.url || f.has_drm) return;

    const protocol = protocolOf(f);
    if (!DIRECT.has(protocol) && !HLS.has(protocol)) return;

    const ext = String(f.ext ?? "").toLowerCase();
    if (ext === "mhtml" || /storyboard/i.test(f.format_note ?? "")) return;

    if (IMAGE_EXTENSIONS.has(ext)) return "image";

    const noVideo = f.vcodec === "none";
    const noAudio = f.acodec === "none";

    if (noVideo && noAudio) return;
    if (noVideo || (!f.vcodec && AUDIO_EXTENSIONS.has(ext))) return "audio";
    if (noAudio) return "video";
    return "both";
}

const heightOf = (f) => f.height ?? 0;
const bitrateOf = (f) => f.tbr ?? f.abr ?? f.vbr ?? 0;
const isCommon = (f) => COMMON_VIDEO.has(String(f.ext).toLowerCase());

// the best of the formats that aren't taller than the quality asked for
// (or the shortest ones, if they all are)
const bestVideo = (formats, quality) => {
    if (!formats.length) return;

    // common files over the rest, even when the rest is bigger
    const common = formats.filter(isCommon);
    if (common.length) formats = common;

    const target = quality === "max" ? Infinity : Number(quality) || Infinity;
    let pool = formats.filter(f => heightOf(f) <= target);
    if (!pool.length) {
        const shortest = Math.min(...formats.map(heightOf));
        pool = formats.filter(f => heightOf(f) === shortest);
    }

    return [...pool].sort((a, b) =>
        heightOf(b) - heightOf(a)
        || (isHLS(a) - isHLS(b))
        || bitrateOf(b) - bitrateOf(a)
    )[0];
}

const bestAudio = (formats) => [...formats].sort((a, b) =>
    (isHLS(a) - isHLS(b))
    || bitrateOf(b) - bitrateOf(a)
)[0];

const biggestImage = (formats) => [...formats].sort((a, b) =>
    (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)
)[0];

// which file(s) to download: { video, audio } (merged), { video } (one file
// with or without sound), { audio } or { image }
export const pickFormats = (formats = [], { quality = "max", isAudioOnly = false } = {}) => {
    const kinds = { both: [], video: [], audio: [], image: [] };
    for (const f of formats) {
        const kind = kindOf(f);
        if (kind) kinds[kind].push(f);
    }

    if (isAudioOnly) {
        const audio = bestAudio(kinds.audio);
        if (audio) return { audio };
        // the sound is taken from a video
        const video = bestVideo(kinds.both, quality);
        if (video) return { video };
        return {};
    }

    const both = bestVideo(kinds.both, quality);
    const video = bestVideo(kinds.video, quality);

    // separate video and audio are joined together, which needs both
    // to be the same kind of file (direct or hls)
    const audio = video && bestAudio(kinds.audio.filter(f => isHLS(f) === isHLS(video)));

    if (video && audio && heightOf(video) > (both ? heightOf(both) : -1)) {
        return { video, audio };
    }
    if (both) return { video: both };
    if (video) return { video };

    if (kinds.audio.length) return { audio: bestAudio(kinds.audio) };
    if (kinds.image.length) return { image: biggestImage(kinds.image) };
    return {};
}

// yt-dlp's cookies are like a set-cookie header, with a domain for each
export const parseCookies = (text) => {
    const cookies = [];
    const attributes = new Set(["domain", "path", "expires", "max-age", "samesite", "comment", "version", "priority"]);

    for (const part of String(text ?? "").split(/;\s*/)) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;

        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();

        if (attributes.has(name.toLowerCase())) {
            if (name.toLowerCase() === "domain" && cookies.length) {
                cookies[cookies.length - 1].domain = value.replace(/^\./, "").toLowerCase();
            }
            continue;
        }

        if (name) cookies.push({ name, value });
    }

    return cookies;
}

const cookieFor = (cookies, url) => {
    const host = new URL(url).hostname.toLowerCase();
    return cookies
        .filter(c => !c.domain || host === c.domain || host.endsWith(`.${c.domain}`))
        .map(c => `${c.name}=${c.value}`)
        .join("; ");
}

// the headers yt-dlp says a file needs, for a request to the given url
export const headersFor = (format, url) => {
    const headers = {};
    for (const [ name, value ] of Object.entries(format.http_headers ?? {})) {
        if (PASSED_HEADERS.has(name.toLowerCase()) && typeof value === "string") {
            headers[name.toLowerCase()] = value;
        }
    }

    const cookie = cookieFor(parseCookies(format.cookies), url);
    if (cookie) headers.cookie = cookie;

    return headers;
}

// follows a file's redirects (checking every address) and makes sure it's
// there, since tunnels of untrusted links don't follow redirects themselves
const checkFile = async (format, service) => {
    let url = format.url;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        await assertSafeURL(url);

        const response = await fetch(url, {
            headers: {
                ...headersFor(format, url),
                ...(isHLS(format) ? {} : { range: "bytes=0-0" }),
            },
            redirect: "manual",
            dispatcher: getSafeDispatcher(service),
            signal: AbortSignal.timeout(CHECK_TIMEOUT),
        });

        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
            await response.body?.cancel().catch(() => {});
            url = new URL(location, url).toString();
            continue;
        }

        if (response.status !== 200 && response.status !== 206) {
            await response.body?.cancel().catch(() => {});
            return;
        }

        if (isHLS(format)) {
            const playlist = await readLimitedText(response, PLAYLIST_SIZE_LIMIT).catch(() => "");
            if (!playlist.includes("#EXTM3U")) return;
        } else {
            await response.body?.cancel().catch(() => {});
        }

        return { url, headers: headersFor(format, url) };
    }
}

const serviceName = (info) =>
    sanitizeString(String(info.extractor_key || info.extractor || "web"))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 30) || "web";

const filenameAttributes = (info, format, extension) => ({
    service: serviceName(info),
    id: sanitizeString(String(info.id ?? "media")).slice(0, 64),
    title: String(info.track || info.title || info.id || "media").slice(0, 150),
    author: info.artist || info.uploader || info.channel || info.creator,
    resolution: format?.height ? `${format.height}p` : undefined,
    qualityLabel: format?.height ? `${format.height}p` : undefined,
    extension,
});

const metadataOf = (info) => {
    const metadata = {
        title: info.track || info.title,
        artist: info.artist || info.uploader || info.channel || info.creator,
        album: info.album,
    };
    for (const key of Object.keys(metadata)) {
        if (!metadata[key]) delete metadata[key];
    }
    return metadata;
}

const audioExtension = (format) => {
    const ext = String(format.ext ?? "").toLowerCase();
    return KEPT_AUDIO.has(ext) && !isHLS(format) ? ext : undefined;
}

// one entry (a video, a song or a picture) -> a result for match-action
const fromEntry = async (info, { quality, isAudioOnly, service }) => {
    if (info.is_live || info.live_status === "is_live" || info.live_status === "is_upcoming") {
        return { error: "content.video.live" };
    }

    if (info.duration > env.durationLimit) {
        return { error: "content.too_long" };
    }

    const picked = pickFormats(info.formats, { quality, isAudioOnly });

    if (picked.image) {
        const file = await checkFile(picked.image, service);
        if (!file) return { error: "fetch.fail" };

        const ext = String(picked.image.ext || "jpg").toLowerCase();
        return {
            urls: file.url,
            headers: file.headers,
            isPhoto: true,
            tunnelService: service,
            filenameAttributes: filenameAttributes(info, undefined, ext),
        }
    }

    const files = [picked.video, picked.audio].filter(Boolean);
    if (!files.length) return { error: "fetch.empty" };

    const checked = await Promise.all(files.map(f => checkFile(f, service).catch(() => {})));
    if (checked.some(f => !f)) return { error: "fetch.fail" };

    const base = {
        filenameAttributes: filenameAttributes(info, picked.video, "mp4"),
        fileMetadata: metadataOf(info),
        // the video's headers (the audio, if separate, is from the same site)
        headers: checked[0].headers,
        isHLS: isHLS(files[0]) || undefined,
        // files are always downloaded through a tunnel: they may need the
        // headers above, or only work for the address that looked them up
        proxy: true,
        tunnelService: service,
    };

    if (picked.video && picked.audio) {
        return { ...base, urls: [checked[0].url, checked[1].url] };
    }

    if (picked.audio) {
        return {
            ...base,
            urls: checked[0].url,
            isAudioOnly: true,
            bestAudio: audioExtension(picked.audio),
            filenameAttributes: filenameAttributes(info, undefined, "mp3"),
        }
    }

    return { ...base, urls: checked[0].url };
}

// a playlist or an album: its videos and pictures to choose from
const fromPlaylist = async (info, options) => {
    const entries = (info.entries ?? []).filter(e => e?.formats?.length);
    if (entries.length === 1) return fromEntry(entries[0], options);

    const items = await Promise.all(entries.slice(0, PICKER_ITEMS).map(async (entry, i) => {
        const picked = pickFormats(entry.formats, { quality: options.quality });
        // only single files: picker items are sent as they are
        const format = picked.image ?? (!picked.audio && picked.video && !isHLS(picked.video) ? picked.video : undefined);
        if (!format) return;

        const file = await checkFile(format, options.service).catch(() => {});
        if (!file) return;

        const type = picked.image ? "photo" : "video";
        const ext = String(format.ext || (type === "photo" ? "jpg" : "mp4")).toLowerCase();

        return {
            type,
            url: createStream({
                service: options.service,
                type: "proxy",
                url: file.url,
                headers: file.headers,
                filename: `${serviceName(info)}_${sanitizeString(String(entry.id ?? i + 1)).slice(0, 64)}.${ext}`,
            }),
        }
    }));

    const picker = items.filter(Boolean);
    if (picker.length > 1) return { picker };

    // nothing to choose from (e.g. an album of songs): the first item
    if (entries.length) return fromEntry(entries[0], options);
    return { error: "fetch.empty" };
}

const ERRORS = new Set([
    "content.video.private", "content.video.age", "content.video.live",
    "content.video.unavailable", "content.region", "content.paid",
    "fetch.rate", "fetch.empty", "fetch.fail",
]);

// tunnels of files yt-dlp found: "generic" for other sites, "generic-<service>"
// for a service's links (untrusted, but with the service's proxy)
export const tunnelServiceFor = (service) =>
    !service || service === "generic" ? "generic" : `generic-${service}`;

// { unsupported: true } when yt-dlp doesn't know the site (or can't be
// reached: then also unreachable), so the link is left to the generic extractor.
// service: the fetchr service of the link, when yt-dlp stands in for it
export default async function ytdlp({ url, quality, isAudioOnly, service = "generic" }) {
    let answer;
    try {
        answer = await askYtdlp(url, service);
    } catch {
        return { unsupported: true, unreachable: true };
    }

    if (!answer?.ok) {
        switch (answer?.error) {
            case "unsupported":
                return { unsupported: true };
            case "unsafe":
                return { error: "link.invalid" };
            case "busy":
                return { error: "fetch.rate" };
            default:
                return { error: ERRORS.has(answer?.error) ? answer.error : "fetch.fail" };
        }
    }

    const info = answer.info ?? {};
    const options = { quality, isAudioOnly, service: tunnelServiceFor(service) };

    try {
        if (info.type === "playlist") {
            return await fromPlaylist(info, options);
        }
        return await fromEntry(info, options);
    } catch {
        return { error: "fetch.fail" };
    }
}
