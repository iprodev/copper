import { request } from "undici";
import { Readable } from "node:stream";
import { closeRequest, getHeaders, pipe } from "./shared.js";
import { handleHlsPlaylist, isHlsResponse, probeInternalHLSTunnel } from "./internal-hls.js";
import { assertSafeURL } from "../security/network.js";
import { isGenericService } from "../processing/service-config.js";

const CHUNK_SIZE = BigInt(8e6); // 8 MB
const min = (a, b) => a < b ? a : b;

const serviceNeedsChunks = new Set(["youtube", "vk"]);
const hlsSkippedHeaders = new Set(["content-length", "content-range", "accept-ranges", "content-encoding"]);

// the tunnel consumer (ffmpeg) must never follow redirects on its own
const alwaysSkippedHeaders = new Set(["location", "refresh"]);

async function* readChunks(streamInfo, size) {
    let read = 0n, chunksSinceTransplant = 0;
    while (read < size) {
        if (streamInfo.controller.signal.aborted) {
            throw new Error("controller aborted");
        }

        const chunk = await request(streamInfo.url, {
            headers: {
                ...getHeaders(streamInfo.service),
                Range: `bytes=${read}-${read + CHUNK_SIZE}`
            },
            dispatcher: streamInfo.dispatcher,
            signal: streamInfo.controller.signal,
            maxRedirections: 4
        });

        if (chunk.statusCode === 403 && chunksSinceTransplant >= 3 && streamInfo.transplant) {
            chunksSinceTransplant = 0;
            try {
                await streamInfo.transplant(streamInfo.dispatcher);
                continue;
            } catch {}
        }

        chunksSinceTransplant++;

        if (chunk.statusCode < 200 || chunk.statusCode > 299) {
            chunk.body.dump().catch(() => {});
            throw new Error(`unexpected status code ${chunk.statusCode}`);
        }

        const expected = min(CHUNK_SIZE, size - read);
        const received = BigInt(chunk.headers['content-length']);

        if (received < expected / 2n) {
            closeRequest(streamInfo.controller);
        }

        for await (const data of chunk.body) {
            yield data;
        }

        read += received;
    }
}

async function handleChunkedStream(streamInfo, res) {
    const { signal } = streamInfo.controller;
    const cleanup = () => (res.end(), closeRequest(streamInfo.controller));

    try {
        let req, attempts = 3;
        while (attempts--) {
            req = await fetch(streamInfo.url, {
                headers: getHeaders(streamInfo.service),
                method: 'HEAD',
                dispatcher: streamInfo.dispatcher,
                signal
            });

            streamInfo.url = req.url;
            if (req.status === 403 && streamInfo.transplant) {
                try {
                    await streamInfo.transplant(streamInfo.dispatcher);
                } catch {
                    break;
                }
            } else break;
        }

        const size = BigInt(req.headers.get('content-length'));

        if (req.status !== 200 || !size) {
            return cleanup();
        }

        const generator = readChunks(streamInfo, size);

        const abortGenerator = () => {
            generator.return();
            signal.removeEventListener('abort', abortGenerator);
        }

        signal.addEventListener('abort', abortGenerator);

        const stream = Readable.from(generator);

        for (const headerName of ['content-type', 'content-length']) {
            const headerValue = req.headers.get(headerName);
            if (headerValue) res.setHeader(headerName, headerValue);
        }

        pipe(stream, res, cleanup);
    } catch {
        cleanup();
    }
}

async function handleGenericStream(streamInfo, res) {
    const { signal } = streamInfo.controller;
    const cleanup = () => res.end();

    try {
        const fileResponse = await request(streamInfo.url, {
            headers: {
                ...Object.fromEntries(streamInfo.headers),
                host: undefined
            },
            dispatcher: streamInfo.dispatcher,
            signal,
            // redirects of generic media are resolved (and checked) during extraction
            maxRedirections: isGenericService(streamInfo.service) ? 0 : 16
        });

        fileResponse.body.on('error', () => {});

        const isOk = fileResponse.statusCode >= 200 && fileResponse.statusCode <= 299;
        const isHls = isOk && isHlsResponse(fileResponse, streamInfo);

        // a rewritten playlist is always sent in full and has a different
        // length than the original, so size and range headers (e.g. from a
        // 206 response to "range: bytes=0-") must not be passed through.
        // otherwise ffmpeg reads a truncated playlist without #EXT-X-ENDLIST
        // and treats the video as a live stream.
        res.status(isHls ? 200 : fileResponse.statusCode);

        for (const [ name, value ] of Object.entries(fileResponse.headers)) {
            const lowerName = name.toLowerCase();
            if (alwaysSkippedHeaders.has(lowerName)) continue;

            if (!isHls || !hlsSkippedHeaders.has(lowerName)) {
                res.setHeader(name, value);
            }
        }

        if (!isOk) {
            return cleanup();
        }

        if (isHls) {
            await handleHlsPlaylist(streamInfo, fileResponse, res);
        } else {
            pipe(fileResponse.body, res, cleanup);
        }
    } catch {
        closeRequest(streamInfo.controller);
        cleanup();
    }
}

export async function internalStream(streamInfo, res) {
    if (streamInfo.headers) {
        streamInfo.headers.delete('icy-metadata');
    }

    // urls of generic tunnels (including hls segments from untrusted
    // playlists) are checked before every request
    if (isGenericService(streamInfo.service)) {
        try {
            await assertSafeURL(streamInfo.url);
        } catch {
            closeRequest(streamInfo.controller);
            res.statusCode = 403;
            return res.end();
        }
    }

    if (serviceNeedsChunks.has(streamInfo.service) && !streamInfo.isHLS) {
        return handleChunkedStream(streamInfo, res);
    }

    return handleGenericStream(streamInfo, res);
}

export async function probeInternalTunnel(streamInfo) {
    // size probes would request untrusted urls outside of the checked path
    if (isGenericService(streamInfo.service)) return;

    try {
        const signal = AbortSignal.timeout(3000);
        const headers = {
            ...Object.fromEntries(streamInfo.headers || []),
            ...getHeaders(streamInfo.service),
            host: undefined,
            range: undefined
        };

        if (streamInfo.isHLS) {
            return probeInternalHLSTunnel({
                ...streamInfo,
                signal,
                headers
            });
        }

        const response = await request(streamInfo.url, {
            method: 'HEAD',
            headers,
            dispatcher: streamInfo.dispatcher,
            signal,
            maxRedirections: 16
        });

        if (response.statusCode !== 200)
            throw "status is not 200 OK";

        const size = +response.headers['content-length'];
        if (isNaN(size))
            throw "content-length is not a number";

        return size;
    } catch {}
}
