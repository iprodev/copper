import HLS from "hls-parser";
import { env, genericUserAgent } from "../../config.js";

const headers = { "user-agent": genericUserAgent };

const FLASHVARS_REGEX = /var flashvars_\d+\s*=\s*(\{.*?\});\s*\n/s;

const pickDefinition = (definitions, quality) => {
    const sorted = definitions
        .filter(d => d?.format === "hls" && d.videoUrl && Number(d.quality))
        .sort((a, b) => Number(b.quality) - Number(a.quality));

    if (quality === "max") return sorted[0];

    return sorted.find(d => Number(d.quality) <= Number(quality)) ?? sorted[sorted.length - 1];
}

const getText = (url) => fetch(url, { headers })
    .then(r => r.status === 200 ? r.text() : r.status)
    .catch(() => 0);

const getFirstSegmentStatus = async (masterUrl) => {
    const master = await getText(masterUrl);
    if (typeof master !== "string") return master;

    let playlist, url = masterUrl;
    try {
        playlist = HLS.parse(master);

        if (playlist.isMasterPlaylist) {
            url = new URL(playlist.variants?.[0]?.uri, masterUrl).toString();
            const media = await getText(url);
            if (typeof media !== "string") return media;
            playlist = HLS.parse(media);
        }
    } catch {
        return 0;
    }

    const segment = playlist.segments?.[0]?.uri;
    if (!segment) return 0;

    return fetch(new URL(segment, url), { headers: { ...headers, range: "bytes=0-0" } })
        .then(async r => (await r.arrayBuffer(), r.status))
        .catch(() => 0);
}

// in regions where the site enforces age verification laws
// (e.g. poland) the hls playlists answer 410, but the direct mp4 files
// still work: they're listed by the "mp4" media definition (/video/get_media,
// which needs the cookies the page sets) and need the page as referer.
const getMp4 = async (definitions, quality, pageUrl, cookie) => {
    const getMedia = definitions.find(d => d?.format === "mp4" && d.videoUrl)?.videoUrl;
    if (!getMedia) return;

    const items = await fetch(getMedia, {
        headers: { ...headers, referer: pageUrl, ...(cookie ? { cookie } : {}) }
    })
        .then(r => r.status === 200 ? r.json() : undefined)
        .catch(() => {});

    if (!Array.isArray(items)) return;

    const sorted = items
        .filter(i => i?.videoUrl && Number(i.quality))
        .sort((a, b) => Number(b.quality) - Number(a.quality));

    const item = quality === "max"
        ? sorted[0]
        : sorted.find(i => Number(i.quality) <= Number(quality)) ?? sorted[sorted.length - 1];

    if (!item) return;

    const fileHeaders = { ...headers, referer: pageUrl };
    const status = await fetch(item.videoUrl, { headers: { ...fileHeaders, range: "bytes=0-0" } })
        .then(async r => (await r.arrayBuffer(), r.status))
        .catch(() => 0);

    if (status !== 200 && status !== 206) return;

    return { url: item.videoUrl, quality: item.quality, headers: fileHeaders };
}

export default async function({ id, quality }) {
    const pageUrl = `https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(id)}`;
    let cookie;

    const html = await fetch(pageUrl, { headers })
        .then(r => {
            if (r.status !== 200) return;
            cookie = r.headers.getSetCookie?.()
                .map(c => c.split(";")[0])
                .join("; ");
            return r.text();
        })
        .catch(() => {});

    if (!html) return { error: "fetch.fail" };

    let flashvars;
    try {
        flashvars = JSON.parse(html.match(FLASHVARS_REGEX)?.[1]);
    } catch {}

    if (!flashvars?.mediaDefinitions) return { error: "fetch.empty" };

    if (Number(flashvars.video_duration) > env.durationLimit) {
        return { error: "content.too_long" };
    }

    const definition = pickDefinition(flashvars.mediaDefinitions, quality);
    if (!definition) return { error: "fetch.empty" };

    // in regions where the site enforces age verification laws,
    // media is listed but the segments respond with 410/403
    const status = await getFirstSegmentStatus(definition.videoUrl);
    const title = flashvars.video_title?.trim();

    if ([403, 404, 410].includes(status)) {
        const mp4 = await getMp4(flashvars.mediaDefinitions, quality, pageUrl, cookie);
        if (!mp4) return { error: "content.region" };

        const mp4Resolution = `${mp4.quality}p`;

        return {
            urls: mp4.url,
            headers: mp4.headers,
            filenameAttributes: {
                service: "pornhub",
                id,
                title: title || id,
                resolution: mp4Resolution,
                qualityLabel: mp4Resolution,
                extension: "mp4",
            },
            fileMetadata: { title },
        }
    }

    if (status !== 200 && status !== 206) return { error: "fetch.fail" };
    const resolution = `${definition.quality}p`;

    return {
        urls: definition.videoUrl,
        isHLS: true,
        filenameAttributes: {
            service: "pornhub",
            id,
            title: title || id,
            resolution,
            qualityLabel: resolution,
            extension: "mp4",
        },
        fileMetadata: { title },
    }
}
