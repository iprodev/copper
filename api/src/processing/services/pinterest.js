import HLS from "hls-parser";
import { genericUserAgent } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";

const videoRegex = /"url":"(https:\/\/v1\.pinimg\.com\/videos\/.*?)"/g;
const videoReferenceRegex = /pinimg\.com(?:\\?\/)+videos/;
const imageRegex = /src="(https:\/\/i\.pinimg\.com\/.*\.(jpg|gif))"/g;
const notFoundRegex = /"__typename"\s*:\s*"PinNotFound"/;
const ogImageRegex = /<meta(?=[^>]*property="og:image")[^>]*content="(https:\/\/i\.pinimg\.com\/[^"]+\.(?:jpg|gif))"/;

const getBestVariant = async (masterUrl) => {
    const master = await fetch(masterUrl, { headers: { "user-agent": genericUserAgent } })
        .then(r => r.status === 200 ? r.text() : undefined)
        .catch(() => {});

    if (!master) return;

    try {
        const best = HLS.parse(master).variants
            ?.filter(v => v.uri)
            ?.sort((a, b) => Number(b.bandwidth) - Number(a.bandwidth))?.[0];

        if (best) return new URL(best.uri, masterUrl).toString();
    } catch {}
}

// pin data from pinterest's json api is the same for every network,
// unlike the html page, which comes in several variants
const fromApi = async (id) => {
    const data = JSON.stringify({
        options: { id, field_set_key: "unauth_react_main_pin" },
        context: {},
    });

    const json = await fetch(
        `https://www.pinterest.com/resource/PinResource/get/?data=${encodeURIComponent(data)}`,
        {
            headers: {
                "user-agent": genericUserAgent,
                "x-pinterest-pws-handler": "www/pin/[id].js",
            }
        }
    ).then(r => r.status === 200 ? r.json() : undefined).catch(() => {});

    const pin = json?.resource_response?.data;
    if (!pin) return;

    const videoLists = [
        pin.videos?.video_list,
        ...(pin.story_pin_data?.pages ?? []).flatMap(
            page => (page?.blocks ?? []).map(block => block?.video?.video_list)
        ),
    ].filter(Boolean);

    const mp4 = videoLists
        .flatMap(list => Object.values(list))
        .filter(v => v?.url?.endsWith(".mp4"))
        .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];

    if (mp4) return {
        urls: mp4.url,
        filename: `pinterest_${id}.mp4`,
        audioFilename: `pinterest_${id}_audio`
    }

    // a video without an mp4 version is left to the html fallback
    if (videoLists.length) return;

    const image = pin.images?.orig?.url;
    if (image?.endsWith(".jpg") || image?.endsWith(".gif") || image?.endsWith(".png")) return {
        urls: image,
        isPhoto: true,
        filename: `pinterest_${id}.${image.split(".").pop()}`
    }
}

export default async function(o) {
    let id = o.id;

    if (!o.id && o.shortLink) {
        const patternMatch = await resolveRedirectingURL(`https://api.pinterest.com/url_shortener/${o.shortLink}/redirect/`);
        id = patternMatch?.id;
    }

    if (id?.includes("--")) id = id.split("--")[1];
    if (!id) return { error: "fetch.fail" };

    const fromJson = await fromApi(id);
    if (fromJson) return fromJson;

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

    // some page variants only list the hls version of a video
    const hlsLink = [...html.matchAll(videoRegex)]
                    .map(([, link]) => link)
                    .find(a => a.endsWith('.m3u8'));

    if (hlsLink) {
        const variant = await getBestVariant(hlsLink);
        if (variant) return {
            urls: variant,
            isHLS: true,
            filename: `pinterest_${id}.mp4`,
            audioFilename: `pinterest_${id}_audio`
        }
    }

    // never fall back to the thumbnail of a video we couldn't extract
    if (videoReferenceRegex.test(html)) return { error: "fetch.empty" };

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
