import { genericUserAgent } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";

const videoRegex = /"url":"(https:\/\/v1\.pinimg\.com\/videos\/.*?)"/g;
const imageRegex = /src="(https:\/\/i\.pinimg\.com\/.*\.(jpg|gif))"/g;
const notFoundRegex = /"__typename"\s*:\s*"PinNotFound"/;
const ogImageRegex = /<meta(?=[^>]*property="og:image")[^>]*content="(https:\/\/i\.pinimg\.com\/[^"]+\.(?:jpg|gif))"/;

export default async function(o) {
    let id = o.id;

    if (!o.id && o.shortLink) {
        const patternMatch = await resolveRedirectingURL(`https://api.pinterest.com/url_shortener/${o.shortLink}/redirect/`);
        id = patternMatch?.id;
    }

    if (id?.includes("--")) id = id.split("--")[1];
    if (!id) return { error: "fetch.fail" };

    const html = await fetch(`https://www.pinterest.com/pin/${id}/`, {
        headers: { "user-agent": genericUserAgent }
    }).then(r => r.text()).catch(() => {});

    if (!html) return { error: "fetch.fail" };

    if (notFoundRegex.test(html)) return { error: "fetch.empty" };

    const videoLink = [...html.matchAll(videoRegex)]
                    .map(([, link]) => link)
                    .find(a => a.endsWith('.mp4'));

    if (videoLink) return {
        urls: videoLink,
        filename: `pinterest_${id}.mp4`,
        audioFilename: `pinterest_${id}_audio`
    }

    // some page variants don't have <img> tags, so og:image is used as a fallback
    const imageLink = [...html.matchAll(imageRegex)]
                    .map(([, link]) => link)
                    .find(a => a.endsWith('.jpg') || a.endsWith('.gif'))
                    ?? html.match(ogImageRegex)?.[1];

    if (imageLink) return {
        urls: imageLink,
        isPhoto: true,
        filename: `pinterest_${id}.${imageLink.endsWith(".gif") ? "gif" : "jpg"}`
    }

    return { error: "fetch.empty" };
}
