import { genericUserAgent } from "../../config.js";
import { createStream } from "../../stream/manage.js";

// threads only includes post data in the page when the request
// looks like a regular browser navigation
const pageHeaders = {
    "user-agent": genericUserAgent,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "sec-ch-ua": '"Chromium";v="138", "Not)A;Brand";v="8", "Google Chrome";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
};

const DATA_SCRIPT_REGEX = /<script type="application\/json"[^>]*data-sjs[^>]*>(.*?)<\/script>/gs;

const MEDIA_TYPE_PHOTO = 1;
const MEDIA_TYPE_VIDEO = 2;

// finds the post object with the given shortcode in the page's json data
const findPost = (html, code) => {
    let post;

    const walk = (node) => {
        if (post || !node || typeof node !== "object") return;

        if (node.code === code && "media_type" in node) {
            post = node;
            return;
        }

        for (const value of Object.values(node)) {
            walk(value);
        }
    }

    for (const [, json] of html.matchAll(DATA_SCRIPT_REGEX)) {
        if (!json.includes(code)) continue;

        try {
            walk(JSON.parse(json));
        } catch {}

        if (post) break;
    }

    return post;
}

const bestVideo = (media) => media?.video_versions?.find(v => v?.url)?.url;

const bestImage = (media) => {
    const candidates = media?.image_versions2?.candidates?.filter(c => c?.url);
    if (!candidates?.length) return;

    return candidates.reduce((a, b) =>
        (a.width ?? 0) * (a.height ?? 0) >= (b.width ?? 0) * (b.height ?? 0) ? a : b
    ).url;
}

const makePicker = (items, id, alwaysProxy) => {
    return items.map((item, i) => {
        const video = bestVideo(item);
        const image = bestImage(item);
        if (!video && !image) return;

        const type = video ? "video" : "photo";
        const ext = video ? "mp4" : "jpg";
        const filename = `threads_${id}_${i + 1}.${ext}`;

        let url = video || image;
        if (alwaysProxy) {
            url = createStream({
                service: "threads",
                type: "proxy",
                url,
                filename,
            });
        }

        return {
            type,
            url,
            // thumbnails can't be loaded cross-origin, so they're always proxied
            thumb: image && createStream({
                service: "threads",
                type: "proxy",
                url: image,
                filename: `threads_${id}_${i + 1}.jpg`,
            }),
        }
    }).filter(Boolean);
}

export default async function({ id, alwaysProxy, dispatcher }) {
    const html = await fetch(`https://www.threads.com/t/${id}`, {
        headers: pageHeaders,
        dispatcher,
    })
    .then(r => r.status === 200 ? r.text() : undefined)
    .catch(() => {});

    if (!html) return { error: "fetch.fail" };

    const post = findPost(html, id);
    if (!post) return { error: "fetch.empty" };

    const carousel = post.carousel_media?.filter(Boolean);
    if (carousel?.length) {
        const picker = makePicker(carousel, id, alwaysProxy);
        if (picker.length) return { picker };
    }

    if (post.media_type === MEDIA_TYPE_VIDEO || post.video_versions?.length) {
        const video = bestVideo(post);
        if (video) return {
            urls: video,
            filename: `threads_${id}.mp4`,
            audioFilename: `threads_${id}_audio`,
        }
    }

    if (post.media_type === MEDIA_TYPE_PHOTO) {
        const image = bestImage(post);
        if (image) return {
            urls: image,
            isPhoto: true,
            filename: `threads_${id}.jpg`,
        }
    }

    // text-only posts don't have anything to download
    return { error: "fetch.empty" };
}
