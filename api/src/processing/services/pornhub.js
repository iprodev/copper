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

export default async function({ id, quality }) {
    const html = await fetch(`https://www.pornhub.com/view_video.php?viewkey=${encodeURIComponent(id)}`, { headers })
        .then(r => r.status === 200 ? r.text() : undefined)
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

    if ([403, 404, 410].includes(status)) return { error: "content.region" };
    if (status !== 200 && status !== 206) return { error: "fetch.fail" };

    const title = flashvars.video_title?.trim();
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
