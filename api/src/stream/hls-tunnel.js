// hls streams for clients that process files themselves (local processing).
//
// a client can't read an hls playlist directly: its segments live on other
// servers, need special headers or a proxy. so an hls tunnel (a proxy tunnel
// with isHLS) answers these requests:
//
//   /tunnel?...&hls=index           the segments, keys and init section, as json
//   /tunnel?...&hls=segment&n=12    segment 12
//   /tunnel?...&hls=key&n=0         decryption key 0 (aes-128)
//   /tunnel?...&hls=map             the init section (fragmented mp4)
//
// the playlist is read once per tunnel through the internal tunnel, which
// rewrites every url in it to an internal tunnel (with the right headers,
// proxies and checks). the result is kept until the tunnel expires.

import HLS from "hls-parser";
import { request } from "undici";

import { destroyInternalStream } from "./manage.js";
import { closeRequest, closeResponse, pipe } from "./shared.js";

// playlists of tunnels in use: tunnel id -> { exp, playlist (promise), playlistUrl }
const playlists = new Map();
const MAX_PLAYLISTS = 1000;

class UnsupportedError extends Error {}

const readText = async (url) => {
    const response = await request(url, { signal: AbortSignal.timeout(20000) });
    if (response.statusCode !== 200) {
        await response.body.dump().catch(() => {});
        throw new Error(`playlist status ${response.statusCode}`);
    }
    return response.body.text();
}

const hex = (bytes) => bytes ? Buffer.from(bytes).toString("hex") : undefined;

const sameByterange = (a, b) =>
    a?.length === b?.length && a?.offset === b?.offset;

async function loadPlaylist(playlistUrl) {
    let playlist = HLS.parse(await readText(playlistUrl));

    // a master playlist: its best variant is used, if the audio is in it
    if (playlist.isMasterPlaylist) {
        const variant = [...playlist.variants]
            .sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];

        if (!variant?.uri || variant.audio?.some(rendition => rendition.uri)) {
            throw new UnsupportedError("separate audio renditions");
        }

        playlist = HLS.parse(await readText(variant.uri));
    }

    if (!playlist.endlist) {
        throw new UnsupportedError("live stream");
    }

    const keys = [];
    let map;
    let nextOffset = {};

    const segments = playlist.segments.map(segment => {
        let key;
        if (segment.key && segment.key.method !== "NONE") {
            if (segment.key.method !== "AES-128" || !segment.key.uri) {
                throw new UnsupportedError(`encryption ${segment.key.method}`);
            }

            let index = keys.findIndex(uri => uri === segment.key.uri);
            if (index === -1) index = keys.push(segment.key.uri) - 1;

            key = {
                index,
                // without an iv, the media sequence number is used
                iv: hex(segment.key.iv),
            };
        }

        if (segment.map) {
            if (map && (map.uri !== segment.map.uri || !sameByterange(map.byterange, segment.map.byterange))) {
                throw new UnsupportedError("several init sections");
            }
            map = segment.map;
        }

        // a byte range without an offset continues where the last one ended
        let byterange;
        if (segment.byterange) {
            const offset = segment.byterange.offset ?? nextOffset[segment.uri] ?? 0;
            byterange = { offset, length: segment.byterange.length };
            nextOffset[segment.uri] = offset + segment.byterange.length;
        }

        return {
            uri: segment.uri,
            byterange,
            duration: segment.duration,
            sequence: segment.mediaSequenceNumber,
            key,
        };
    });

    if (!segments.length) {
        throw new UnsupportedError("no segments");
    }

    return { segments, keys, map };
}

// the playlist of a tunnel, read once and kept until the tunnel expires
function getPlaylist(tunnelId, streamInfo) {
    const cached = playlists.get(tunnelId);

    if (cached) {
        // every request of a tunnel gets a new internal stream (wrapStream),
        // only the first one is used to read the playlist
        destroyInternalStream(streamInfo.urls);
        return cached.playlist;
    }

    // too many tunnels at once: the oldest is forgotten
    if (playlists.size >= MAX_PLAYLISTS) {
        forget(playlists.keys().next().value);
    }

    const entry = {
        playlistUrl: streamInfo.urls,
        playlist: loadPlaylist(streamInfo.urls),
    };

    entry.timer = setTimeout(() => forget(tunnelId), Math.max(0, streamInfo.exp - Date.now()));
    entry.timer.unref?.();
    playlists.set(tunnelId, entry);

    // a playlist that couldn't be read isn't kept
    entry.playlist.catch(() => forget(tunnelId));

    return entry.playlist;
}

function forget(tunnelId) {
    const entry = playlists.get(tunnelId);
    if (!entry) return;

    clearTimeout(entry.timer);
    playlists.delete(tunnelId);

    // the internal streams of all segments go away with the playlist's
    destroyInternalStream(entry.playlistUrl);
}

// sends one part (segment, key, init section) of the stream
async function sendPart(url, byterange, res) {
    const controller = new AbortController();
    const shutdown = () => (closeRequest(controller), closeResponse(res));

    try {
        const headers = byterange
            ? { range: `bytes=${byterange.offset}-${byterange.offset + byterange.length - 1}` }
            : {};

        const response = await request(url, { headers, signal: controller.signal });

        if (response.statusCode < 200 || response.statusCode > 299) {
            await response.body.dump().catch(() => {});
            return res.status(502).end();
        }

        res.status(200);
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Content-Type", response.headers["content-type"] || "application/octet-stream");
        if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
        }

        pipe(response.body, res, shutdown);
    } catch {
        shutdown();
    }
}

export default async function hlsTunnel(tunnelId, streamInfo, query, res) {
    let playlist;
    try {
        playlist = await getPlaylist(tunnelId, streamInfo);
    } catch (e) {
        // the client processes the file another way (e.g. on the server)
        return res.status(e instanceof UnsupportedError ? 422 : 502).end();
    }

    const { segments, keys, map } = playlist;
    const n = Number(query.n);

    switch (query.hls) {
        case "index":
            res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
            return res.json({
                // fragmented mp4 has an init section, mpeg-ts doesn't
                format: map ? "fmp4" : "ts",
                map: !!map,
                keys: keys.length,
                duration: segments.reduce((total, segment) => total + segment.duration, 0),
                segments: segments.map(segment => ({
                    duration: segment.duration,
                    sequence: segment.sequence,
                    key: segment.key,
                })),
            });

        case "segment":
            if (!Number.isInteger(n) || !segments[n]) return res.status(400).end();
            return sendPart(segments[n].uri, segments[n].byterange, res);

        case "key":
            if (!Number.isInteger(n) || !keys[n]) return res.status(400).end();
            return sendPart(keys[n], undefined, res);

        case "map":
            if (!map) return res.status(400).end();
            return sendPart(map.uri, map.byterange, res);

        default:
            return res.status(400).end();
    }
}
