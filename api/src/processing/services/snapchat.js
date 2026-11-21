import { resolveRedirectingURL } from "../url.js";
import { genericUserAgent } from "../../config.js";
import { createStream } from "../../stream/manage.js";

const SPOTLIGHT_VIDEO_REGEX = /<link data-react-helmet="true" rel="preload" href="([^"]+)" as="video"\/>/;
const NEXT_DATA_REGEX = /<script id="__NEXT_DATA__" type="application\/json">\s*({.+?})\s*<\/script>/s;
const LD_JSON_REGEX = /<script[^>]*type="application\/ld\+json"[^>]*>(.+?)<\/script>/gs;

const isSnapchatCDN = (url) => {
    try {
        return new URL(url).hostname.endsWith(".sc-cdn.net");
    } catch {
        return false;
    }
}

// spotlight pages now embed the video as a schema.org VideoObject
const findVideoObject = (html) => {
    for (const [, json] of html.matchAll(LD_JSON_REGEX)) {
        try {
            const data = JSON.parse(json);
            if (data?.["@type"] === "VideoObject" && isSnapchatCDN(data.contentUrl)) {
                return data.contentUrl;
            }
        } catch {}
    }
}

async function getSpotlight(id) {
    const html = await fetch(`https://www.snapchat.com/spotlight/${id}`, {
        headers: { 'user-agent': genericUserAgent }
    }).then((r) => r.text()).catch(() => null);

    if (!html) {
        return { error: "fetch.fail" };
    }

    let videoURL = html.match(SPOTLIGHT_VIDEO_REGEX)?.[1];
    if (!isSnapchatCDN(videoURL)) {
        videoURL = findVideoObject(html);
    }

    if (videoURL && isSnapchatCDN(videoURL)) {
        return {
            urls: videoURL,
            filename: `snapchat_${id}.mp4`,
            audioFilename: `snapchat_${id}_audio`
        }
    }
}

async function getStory(username, storyId, alwaysProxy) {
    const html = await fetch(
        `https://www.snapchat.com/add/${username}${storyId ? `/${storyId}` : ''}`,
        { headers: { 'user-agent': genericUserAgent } }
    )
    .then((r) => r.text())
    .catch(() => null);

    if (!html) {
        return { error: "fetch.fail" };
    }

    const nextDataString = html.match(NEXT_DATA_REGEX)?.[1];
    if (nextDataString) {
        const data = JSON.parse(nextDataString);
        const storyIdParam = data?.query?.profileParams?.[1];

        if (storyIdParam && data?.props?.pageProps?.story) {
            const story = data.props.pageProps.story.snapList.find((snap) => snap.snapId.value === storyIdParam);
            if (story) {
                if (story.snapMediaType === 0) {
                    return {
                        urls: story.snapUrls.mediaUrl,
                        filename: `snapchat_${storyId}.jpg`,
                        isPhoto: true
                    }
                }

                return {
                    urls: story.snapUrls.mediaUrl,
                    filename: `snapchat_${storyId}.mp4`,
                    audioFilename: `snapchat_${storyId}_audio`
                }
            }
        }

        const pageProps = data?.props?.pageProps;

        // profiles without curated highlights may still have spotlight videos
        let snapList = pageProps?.curatedHighlights?.[0]?.snapList;
        if (!snapList?.length) {
            snapList = pageProps?.spotlightHighlights?.flatMap(h => h?.snapList ?? []);
        }

        if (snapList?.length) {
            return {
                picker: snapList.map(snap => {
                    const snapType = snap.snapMediaType === 0 ? "photo" : "video";
                    const snapExt = snapType === "video" ? "mp4" : "jpg";
                    let snapUrl = snap.snapUrls.mediaUrl;

                    const proxy = createStream({
                        service: "snapchat",
                        type: "proxy",
                        url: snapUrl,
                        filename: `snapchat_${username}_${snap.timestampInSec.value}.${snapExt}`,
                    });

                    let thumbProxy;
                    if (snapType === "video") thumbProxy = createStream({
                        service: "snapchat",
                        type: "proxy",
                        url: snap.snapUrls.mediaPreviewUrl.value,
                    });

                    if (alwaysProxy) snapUrl = proxy;

                    return {
                        type: snapType,
                        url: snapUrl,
                        thumb: thumbProxy || proxy,
                    }
                })
            }
        }
    }
}

export default async function (obj) {
    let params = obj;
    if (obj.shortLink) {
        params = await resolveRedirectingURL(`https://t.snapchat.com/${obj.shortLink}`);
    }

    if (params?.spotlightId) {
        const result = await getSpotlight(params.spotlightId);
        if (result) return result;
    } else if (params?.username) {
        const result = await getStory(params.username, params.storyId, obj.alwaysProxy);
        if (result) return result;
    }

    return { error: "fetch.fail" };
}
