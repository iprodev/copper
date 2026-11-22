import HLS from "hls-parser";
import { env, genericUserAgent } from "../../config.js";

const headers = { "user-agent": genericUserAgent };

const playerValue = (html, name) =>
    html.match(new RegExp(`html5player\\.${name}\\('([^']*)'\\)`))?.[1];

const decodeEntities = (text) => text
    ?.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    ?.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    ?.replace(/&([a-z])(acute|grave|circ|tilde|uml|cedil);/gi, (_, letter, mark) => {
        const marks = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧" };
        return (letter + marks[mark.toLowerCase()]).normalize("NFC");
    })
    ?.replace(/&quot;/g, '"')
    ?.replace(/&#039;|&apos;/g, "'")
    ?.replace(/&lt;/g, "<")
    ?.replace(/&gt;/g, ">")
    ?.replace(/&amp;/g, "&");

const pickVariant = (variants, quality) => {
    const sorted = variants
        .filter(v => v.uri && v.resolution)
        .sort((a, b) => b.resolution.height - a.resolution.height);

    if (quality === "max") return sorted[0];

    // vertical videos are described by their short side
    const shortSide = v => Math.min(v.resolution.width, v.resolution.height);
    return sorted.find(v => shortSide(v) <= Number(quality)) ?? sorted[sorted.length - 1];
}

export default async function({ id, quality }) {
    // numeric ids belong to the old url format, both redirect to the canonical page
    const path = /^\d+$/.test(id) ? `video${id}` : `video.${id}`;

    const html = await fetch(`https://www.xvideos.com/${path}/_`, { headers })
        .then(r => r.status === 200 ? r.text() : undefined)
        .catch(() => {});

    if (!html) return { error: "fetch.fail" };

    const hlsUrl = playerValue(html, "setVideoHLS");
    const mp4Url = playerValue(html, "setVideoUrlHigh") || playerValue(html, "setVideoUrlLow");

    if (!hlsUrl && !mp4Url) {
        // in regions with age verification laws, a verification page is
        // served instead of the player
        if (/age[\s_-]?verif|verify your age/i.test(html)) {
            return { error: "content.region" };
        }
        return { error: "fetch.empty" };
    }

    const duration = Number(html.match(/<meta property="og:duration" content="(\d+)"/)?.[1]);
    if (duration > env.durationLimit) {
        return { error: "content.too_long" };
    }

    const title = decodeEntities(playerValue(html, "setVideoTitle"))?.trim();
    const author = decodeEntities(playerValue(html, "setUploaderName"))?.trim();
    const fileMetadata = { title, artist: author };

    const filenameAttributes = (resolution) => ({
        service: "xvideos",
        id,
        title,
        author,
        resolution,
        qualityLabel: resolution,
        extension: "mp4",
    });

    if (hlsUrl) {
        const master = await fetch(hlsUrl, { headers })
            .then(r => r.status === 200 ? r.text() : undefined)
            .catch(() => {});

        let variant;
        try {
            variant = master && pickVariant(HLS.parse(master).variants ?? [], quality);
        } catch {}

        if (variant) {
            const resolution = `${Math.min(variant.resolution.width, variant.resolution.height)}p`;

            return {
                urls: new URL(variant.uri, hlsUrl).toString(),
                isHLS: true,
                filenameAttributes: filenameAttributes(resolution),
                fileMetadata,
            }
        }
    }

    if (mp4Url) return {
        urls: mp4Url,
        filenameAttributes: filenameAttributes("mp4"),
        fileMetadata,
    }

    return { error: "fetch.empty" };
}
