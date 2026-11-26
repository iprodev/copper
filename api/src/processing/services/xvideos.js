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

// width and height of the video track, from the start of an mp4 file: the
// "tkhd" box of each track has them (as 16.16 fixed point numbers), and
// audio tracks have 0. only works when the file starts with its "moov" box.
export const mp4Dimensions = (buffer) => {
    let at = 0;
    while ((at = buffer.indexOf("tkhd", at)) !== -1) {
        const start = at + 4;
        // version 1 boxes have 64-bit times
        const sizeAt = start + (buffer[start] === 1 ? 88 : 76);
        if (sizeAt + 8 > buffer.length) return;

        const width = buffer.readUInt32BE(sizeAt) >>> 16;
        const height = buffer.readUInt32BE(sizeAt + 4) >>> 16;
        if (width && height) return { width, height };

        at = start;
    }
}

const probeMp4 = (url) => fetch(url, {
    headers: { ...headers, range: "bytes=0-65535" },
    signal: AbortSignal.timeout(10000),
})
    .then(async r => r.ok ? mp4Dimensions(Buffer.from(await r.arrayBuffer())) : undefined)
    .catch(() => {});

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
            const shortSide = Math.min(variant.resolution.width, variant.resolution.height);
            const resolution = `${shortSide}p`;

            // the same quality as a single mp4 file (usually up to 480p) is
            // simpler to download than hls: no segments, and it can resume
            if (mp4Url) {
                const mp4 = await probeMp4(mp4Url);
                if (mp4 && Math.min(mp4.width, mp4.height) === shortSide) {
                    return {
                        urls: mp4Url,
                        filenameAttributes: filenameAttributes(resolution),
                        fileMetadata,
                    }
                }
            }

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
