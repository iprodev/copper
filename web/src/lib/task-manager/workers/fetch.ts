import * as Storage from "$lib/storage";
import { OPFSStorage } from "$lib/storage/opfs";
import { Transmuxer } from "mux.js/lib/mp4/transmuxer";
import probe from "mux.js/lib/m2ts/probe";

import type { AbstractStorage } from "$lib/storage/storage";

const networkErrors = [
    "TypeError: Failed to fetch",
    "TypeError: network error",
];

// tries after the first one, for network problems and server errors
const RETRIES = 3;

// progress is reported at most this often
const PROGRESS_INTERVAL = 250;

// the file and the processed result are both kept in the browser's
// storage for a while, so about twice the file's size has to be free
const SPACE_FACTOR = 2.2;

type Attempt =
    | { file: File }
    | { error: string, retry: boolean, status?: number };

// what's left from earlier attempts, so a download can continue
type Download = {
    storage?: AbstractStorage,
    received: number,
    // the full size, when the server said it (needed to continue)
    total?: number,
    expectedSize?: number,
    contentType?: string,
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// a failed download leaves nothing behind in the browser's storage
const discard = async (storage?: AbstractStorage) => {
    if (!storage) return;
    try {
        // closes the file first, an open file can't be removed
        await storage.res();
    } catch { /* already closed */ }
    try {
        await storage.destroy();
    } catch { /* already gone */ }
}

// whether the browser has room for a file of this size
const hasSpaceFor = async (size: number) => {
    // files are only kept on disk with opfs, the in-memory storage can't be checked
    if (!size || !navigator.storage?.estimate || !(await OPFSStorage.isAvailable())) {
        return true;
    }

    try {
        const { quota, usage } = await navigator.storage.estimate();
        if (quota === undefined || usage === undefined) return true;
        return quota - usage >= size * SPACE_FACTOR;
    } catch {
        return true;
    }
}

const attempt = async (url: string, download: Download): Promise<Attempt> => {
    // after an interruption, only the rest of the file is requested
    const resuming = download.received > 0 && download.total !== undefined;

    try {
        const response = await fetch(url, resuming ? {
            headers: { Range: `bytes=${download.received}-` },
        } : undefined);

        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            return {
                error: "queue.fetch.bad_response",
                // an expired or unknown tunnel won't work on a retry,
                // server errors and "too many requests" might
                retry: response.status >= 500 || response.status === 429,
                status: response.status,
            };
        }

        if (resuming) {
            // a 206 starts where it was asked to, unless content-range says otherwise.
            // (servers on another origin have to expose content-range to be readable)
            const range = response.headers.get('Content-Range');
            const start = range ? Number(range.match(/^bytes (\d+)-/)?.[1]) : download.received;

            // the server sent the whole file instead of the rest: start over
            if (response.status !== 206 || start !== download.received) {
                download.received = 0;
            }
        } else {
            download.contentType = response.headers.get('Content-Type')
                                    || 'application/octet-stream';

            const contentLength = response.headers.get('Content-Length');
            const estimatedLength = response.headers.get('Estimated-Content-Length');

            download.total = contentLength ? +contentLength : undefined;
            download.expectedSize = download.total ?? (estimatedLength ? +estimatedLength : undefined);

            if (download.expectedSize && !(await hasSpaceFor(download.expectedSize))) {
                await response.body?.cancel().catch(() => {});
                return { error: "queue.fetch.no_space", retry: false };
            }
        }

        const reader = response.body?.getReader();
        if (!reader) {
            return { error: "queue.fetch.no_file_reader", retry: false };
        }

        download.storage ??= await Storage.init(download.expectedSize);

        let lastProgress = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            await download.storage.write(value, download.received);
            download.received += value.length;

            if (download.expectedSize && Date.now() - lastProgress > PROGRESS_INTERVAL) {
                lastProgress = Date.now();
                self.postMessage({
                    fetchrFetchWorker: {
                        progress: Math.round((download.received / download.expectedSize) * 100),
                        size: download.received,
                    }
                });
            }
        }

        if (download.received === 0) {
            return { error: "queue.fetch.empty_tunnel", retry: true };
        }

        const file = Storage.retype(await download.storage.res(), download.contentType!);

        if (download.total !== undefined && download.total !== file.size) {
            await discard(download.storage);
            download.storage = undefined;
            download.received = 0;
            return { error: "queue.fetch.corrupted_file", retry: true };
        }

        return { file };
    } catch (e) {
        // network problems are worth another try. what was downloaded
        // so far is kept, the next attempt continues from there
        if (networkErrors.includes(String(e))) {
            return { error: "queue.fetch.network_error", retry: true };
        }

        console.error("error from the fetch worker:");
        console.error(e);
        return { error: "queue.fetch.crashed", retry: false };
    }
}

const fetchFile = async (url: string) => {
    const download: Download = { received: 0 };

    for (let i = 0; i <= RETRIES; i++) {
        const result = await attempt(url, download);

        if ("file" in result) {
            self.postMessage({
                fetchrFetchWorker: {
                    result: result.file
                }
            });
            return;
        }

        if (!result.retry || i === RETRIES) {
            await discard(download.storage);
            self.postMessage({
                fetchrFetchWorker: {
                    error: result.error,
                    status: result.status,
                }
            });
            return;
        }

        // a short pause before trying again, longer each time
        await sleep(1000 * (i + 1));
    }
}

// ---------------------------------------------------------------- hls streams
//
// an hls tunnel (".../tunnel?...&hls=1") gives the segments of a stream one by
// one (see api/src/stream/hls-tunnel.js). they're downloaded a few at a time,
// decrypted if needed and joined into one file (mpeg-ts or fragmented mp4),
// which ffmpeg turns into a regular file afterwards.

// segments on their way at the same time, and how far ahead of the
// first unwritten one they can be
const HLS_PARALLEL = 4;
const HLS_WINDOW = 8;

type HlsIndex = {
    format: "ts" | "fmp4",
    map: boolean,
    keys: number,
    duration: number,
    segments: {
        duration: number,
        sequence: number,
        key?: { index: number, iv?: string },
    }[],
};

class PartError extends Error {
    constructor(public code: string, public retry: boolean, public status?: number) {
        super(code);
    }
}

const partUrl = (tunnel: string, params: Record<string, string>) => {
    const url = new URL(tunnel);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

// one request with retries for network and server errors
const fetchPart = async (url: string, read: "json" | "bytes" = "bytes") => {
    for (let i = 0; ; i++) {
        try {
            const response = await fetch(url);

            if (!response.ok) {
                await response.body?.cancel().catch(() => {});
                // 422: this stream can't be processed locally (e.g. a live stream)
                if (response.status === 422) {
                    throw new PartError("queue.fetch.hls_unsupported", false, 422);
                }
                // server errors and "too many requests" are worth another try
                throw new PartError(
                    "queue.fetch.bad_response",
                    response.status >= 500 || response.status === 429,
                    response.status,
                );
            }

            return read === "json" ? await response.json() : new Uint8Array(await response.arrayBuffer());
        } catch (e) {
            const error = e instanceof PartError ? e
                : networkErrors.includes(String(e)) ? new PartError("queue.fetch.network_error", true)
                : new PartError("queue.fetch.crashed", false);

            if (!error.retry || i >= RETRIES) throw error;
            // after "too many requests", a longer pause
            await sleep((error.status === 429 ? 5000 : 1000) * (i + 1));
        }
    }
}

// the browser's ffmpeg can't read mpeg-ts, so ts segments are turned into
// fragmented mp4 on the way (with mux.js). mux.js handles h264 video and aac
// audio: streams with anything else would lose a track (e.g. mp3 audio), so
// they're refused and processed by the server instead.
const TS_PACKET = 188;
const TS_SUPPORTED_TYPES = new Set([
    0x1b, // h264
    0x0f, // aac
    0x15, // id3 metadata
    0x86, // scte-35 cues
]);

const tsStreamTypes = (bytes: Uint8Array) => {
    let pmtPid: number | undefined;

    for (let i = 0; i + TS_PACKET <= bytes.length; i += TS_PACKET) {
        if (bytes[i] !== 0x47) continue;
        const packet = bytes.subarray(i, i + TS_PACKET);
        const type = probe.parseType(packet, pmtPid);

        if (type === "pat") {
            pmtPid = probe.parsePat(packet);
        } else if (type === "pmt") {
            return Object.values(probe.parsePmt(packet));
        }
    }
}

const tsToMp4 = () => {
    const transmuxer = new Transmuxer({ remux: true, keepOriginalTimestamps: false });
    let output: Uint8Array[] = [];
    let initWritten = false;

    transmuxer.on("data", segment => {
        if (!initWritten) {
            output.push(segment.initSegment);
            initWritten = true;
        }
        output.push(segment.data);
    });

    // returns the fragmented mp4 of one more ts segment
    return (segment: Uint8Array) => {
        output = [];
        transmuxer.push(segment);
        transmuxer.flush();

        const size = output.reduce((total, part) => total + part.length, 0);
        const joined = new Uint8Array(size);
        let offset = 0;
        for (const part of output) {
            joined.set(part, offset);
            offset += part.length;
        }
        return joined;
    }
}

// aes-128: the iv is given, or it's the segment's sequence number
const ivFor = (segment: HlsIndex["segments"][number]) => {
    const iv = new Uint8Array(16);
    if (segment.key?.iv) {
        const bytes = segment.key.iv.match(/../g)!.map(byte => parseInt(byte, 16));
        iv.set(bytes.slice(-16), 16 - Math.min(16, bytes.length));
    } else {
        new DataView(iv.buffer).setUint32(12, segment.sequence);
    }
    return iv;
}

const fetchHls = async (tunnel: string) => {
    let storage: AbstractStorage | undefined;

    try {
        const index: HlsIndex = await fetchPart(partUrl(tunnel, { hls: "index" }), "json");
        const total = index.segments.length;

        const keys = await Promise.all(
            Array.from({ length: index.keys }, async (_, i) => {
                const raw = await fetchPart(partUrl(tunnel, { hls: "key", n: String(i) }));
                return crypto.subtle.importKey("raw", raw, "AES-CBC", false, ["decrypt"]);
            })
        );

        const getSegment = async (i: number) => {
            const segment = index.segments[i];
            const data = await fetchPart(partUrl(tunnel, { hls: "segment", n: String(i) }));

            if (!segment.key) return data;
            return new Uint8Array(await crypto.subtle.decrypt(
                { name: "AES-CBC", iv: ivFor(segment) },
                keys[segment.key.index],
                data,
            ));
        }

        storage = await Storage.init();
        let offset = 0;

        // fragmented mp4 starts with its init section
        if (index.map) {
            const map = await fetchPart(partUrl(tunnel, { hls: "map" }));
            await storage.write(map, offset);
            offset += map.length;
        }

        const ready = new Map<number, Uint8Array>();
        let next = 0, written = 0, lastProgress = 0;
        let checkedSpace = false;
        let writing = Promise.resolve();

        // ts segments become fragmented mp4
        let transmux: ((segment: Uint8Array) => Uint8Array) | undefined;

        // segments are written in order, whichever arrives first
        const writeReady = async () => {
            while (ready.has(written)) {
                const data = ready.get(written)!;
                ready.delete(written);

                if (index.format === "ts") {
                    if (!transmux) {
                        const types = tsStreamTypes(data);
                        if (!types?.length || types.some(type => !TS_SUPPORTED_TYPES.has(type))) {
                            throw new PartError("queue.fetch.hls_unsupported", false);
                        }
                        transmux = tsToMp4();
                    }
                }

                // the first segment tells about how big the whole file will be
                if (!checkedSpace) {
                    checkedSpace = true;
                    const first = index.segments[0].duration || 1;
                    const estimate = data.length / first * index.duration;
                    if (!(await hasSpaceFor(estimate))) {
                        throw new PartError("queue.fetch.no_space", false);
                    }
                }

                const bytes = transmux ? transmux(data) : data;
                await storage!.write(bytes, offset);
                offset += bytes.length;
                written++;

                if (Date.now() - lastProgress > PROGRESS_INTERVAL || written === total) {
                    lastProgress = Date.now();
                    self.postMessage({
                        fetchrFetchWorker: {
                            progress: Math.round(written / total * 100),
                            size: offset,
                        }
                    });
                }
            }
        }

        const downloader = async () => {
            while (next < total) {
                // don't get too far ahead of the segment that's written next
                while (next - written >= HLS_WINDOW) await sleep(50);
                if (next >= total) return;

                const i = next++;
                ready.set(i, await getSegment(i));
                writing = writing.then(writeReady);
                await writing;
            }
        }

        await Promise.all(Array.from({ length: Math.min(HLS_PARALLEL, total) }, downloader));
        await writing;

        if (written !== total) {
            throw new PartError("queue.fetch.corrupted_file", false);
        }

        // ts segments were turned into mp4 too
        const file = Storage.retype(await storage.res(), "video/mp4");

        self.postMessage({ fetchrFetchWorker: { result: file } });
    } catch (e) {
        await discard(storage);

        const error = e instanceof PartError ? e : new PartError("queue.fetch.crashed", false);
        if (!(e instanceof PartError)) {
            console.error("error from the fetch worker (hls):");
            console.error(e);
        }

        self.postMessage({
            fetchrFetchWorker: {
                error: error.code,
                status: error.status,
            }
        });
    }
}

self.onmessage = async (event: MessageEvent) => {
    if (event.data.fetchrFetchWorker) {
        const { url } = event.data.fetchrFetchWorker;

        if (new URL(url).searchParams.get("hls") === "1") {
            await fetchHls(url);
        } else {
            await fetchFile(url);
        }

        self.close();
    }
}
