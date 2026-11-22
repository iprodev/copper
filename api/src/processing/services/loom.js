import HLS from "hls-parser";
import { genericUserAgent } from "../../config.js";

const craftHeaders = id => ({
    "user-agent": genericUserAgent,
    "content-type": "application/json",
    origin: "https://www.loom.com",
    referer: `https://www.loom.com/share/${id}`,
    cookie: `loom_referral_video=${id};`,
    "x-loom-request-source": "loom_web_be851af",
});

const videoSourceQuery = `
    query GetVideoSource($videoId: ID!, $password: String, $acceptableMimes: [CloudfrontVideoAcceptableMime]) {
        getVideo(id: $videoId, password: $password) {
            __typename
            ... on RegularUserVideo {
                nullableRawCdnUrl(acceptableMimes: $acceptableMimes, password: $password) {
                    url
                }
            }
        }
    }`;

async function getVideoSource(id, acceptableMimes) {
    const gql = await fetch("https://www.loom.com/graphql", {
        method: "POST",
        headers: craftHeaders(id),
        body: JSON.stringify({
            operationName: "GetVideoSource",
            variables: {
                videoId: id,
                password: null,
                acceptableMimes,
            },
            query: videoSourceQuery,
        })
    })
    .then(r => r.status === 200 && r.json())
    .catch(() => {});

    return gql?.data?.getVideo?.nullableRawCdnUrl?.url;
}

// loom's hls files are signed with query params that every
// media playlist and segment needs, so we carry them over
const withSignature = (uri, playlistUrl) => {
    const url = new URL(uri, playlistUrl);
    if (!url.search) {
        url.search = playlistUrl.search;
    }
    return url.toString();
}

async function fromHLS(id) {
    const source = await getVideoSource(id, ["M3U8"]);
    if (!source?.includes(".m3u8")) return;

    const masterUrl = new URL(source);
    const master = await fetch(masterUrl)
        .then(r => r.status === 200 && r.text())
        .catch(() => {});

    if (!master) return;

    let playlist;
    try {
        playlist = HLS.parse(master);
    } catch {
        return;
    }

    const variant = playlist.variants
        ?.filter(v => v.uri)
        ?.sort((a, b) => Number(b.bandwidth) - Number(a.bandwidth))?.[0];

    if (!variant) return;

    const video = withSignature(variant.uri, masterUrl);
    const audio = variant.audio?.find(a => a.uri);

    if (audio) {
        return [video, withSignature(audio.uri, masterUrl)];
    }

    return video;
}

async function getTranscript(id) {
    const gql = await fetch(`https://www.loom.com/graphql`, {
        method: "POST",
        headers: craftHeaders(id),
        body: JSON.stringify({
            operationName: "FetchVideoTranscriptForFetchTranscript",
            variables: {
                videoId: id,
                password: null,
            },
            query: `
                query FetchVideoTranscriptForFetchTranscript($videoId: ID!, $password: String) {
                    fetchVideoTranscript(videoId: $videoId, password: $password) {
                        ... on VideoTranscriptDetails {
                        captions_source_url
                        language
                        __typename
                        }
                        ... on GenericError {
                        message
                        __typename
                        }
                        __typename
                    }
                }`,
        })
    })
    .then(r => r.status === 200 && r.json())
    .catch(() => {});

    if (gql?.data?.fetchVideoTranscript?.captions_source_url?.includes('.vtt?')) {
        return gql.data.fetchVideoTranscript.captions_source_url;
    }
}

export default async function({ id, subtitleLang }) {
    let urls, isHLS = false;

    const mp4 = await getVideoSource(id, ["MP4"]);
    if (mp4?.includes(".mp4")) {
        urls = mp4;
    } else {
        urls = await fromHLS(id);
        isHLS = !!urls;
    }

    if (!urls) {
        return { error: "fetch.empty" }
    }

    let subtitles;
    if (subtitleLang) {
        const transcript = await getTranscript(id);
        if (transcript) subtitles = transcript;
    }

    return {
        urls,
        isHLS,
        subtitles,
        filename: `loom_${id}.mp4`,
        audioFilename: `loom_${id}_audio`
    }
}
