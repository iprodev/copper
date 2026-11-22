import HLS from "hls-parser";
import { env, genericUserAgent } from "../../config.js";

const headers = { "user-agent": genericUserAgent };

const API = "https://store.externulls.com";
const VIDEO_CDN = "https://video.beeg.com";

const pickVariant = (variants, quality) => {
    // h264 has the best compatibility, av1 & h265 variants are skipped
    const sorted = variants
        .filter(v => v.uri && v.resolution && /avc1/.test(v.codecs ?? ""))
        .sort((a, b) => b.resolution.height - a.resolution.height);

    if (quality === "max") return sorted[0];

    const shortSide = v => Math.min(v.resolution.width, v.resolution.height);
    return sorted.find(v => shortSide(v) <= Number(quality)) ?? sorted[sorted.length - 1];
}

export default async function({ id, quality }) {
    // beeg links look like beeg.com/-0786924192839399,
    // while the api expects the number without leading zeros
    const fileId = String(id).replace(/^-/, "").replace(/^0+/, "");
    if (!/^\d+$/.test(fileId)) return { error: "link.unsupported" };

    const [facts, playPath] = await Promise.all([
        fetch(`${API}/facts/file/${fileId}`, { headers })
            .then(r => r.status === 200 ? r.json() : undefined)
            .catch(() => {}),
        fetch(`${API}/video/play_url/${fileId}`, { headers })
            .then(r => r.status === 200 ? r.text() : undefined)
            .catch(() => {}),
    ]);

    if (!facts?.file || !playPath || !playPath.includes(".m3u8")) {
        return { error: "fetch.empty" };
    }

    if (facts.file.fl_duration > env.durationLimit) {
        return { error: "content.too_long" };
    }

    // in regions that require age verification, beeg only allows a short
    // preview: the signed path includes a limit (in seconds) that's shorter
    // than the video, and segments after it are refused
    const limit = Number(playPath.match(/[,/]limit=(\d+)/)?.[1]);
    if (limit && facts.file.fl_duration && limit < facts.file.fl_duration - 1) {
        return { error: "content.region" };
    }

    const masterUrl = new URL(playPath.trim().replace(/^\/?/, "/"), VIDEO_CDN);
    const master = await fetch(masterUrl, { headers })
        .then(r => r.status === 200 ? r.text() : undefined)
        .catch(() => {});

    if (!master) return { error: "fetch.fail" };

    let variant;
    try {
        variant = pickVariant(HLS.parse(master).variants ?? [], quality);
    } catch {}

    if (!variant) return { error: "fetch.empty" };

    const title = facts.file.data
        ?.find(d => d?.cd_column === "sf_name")
        ?.cd_value?.trim();

    const resolution = `${Math.min(variant.resolution.width, variant.resolution.height)}p`;

    return {
        urls: new URL(variant.uri, masterUrl).toString(),
        isHLS: true,
        filenameAttributes: {
            service: "beeg",
            id: fileId,
            title: title || fileId,
            resolution,
            qualityLabel: resolution,
            extension: "mp4",
        },
        fileMetadata: { title },
    }
}
