import * as Storage from "$lib/storage";
import { OPFSStorage } from "$lib/storage/opfs";

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
                // only server errors might
                retry: response.status >= 500,
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

self.onmessage = async (event: MessageEvent) => {
    if (event.data.fetchrFetchWorker) {
        await fetchFile(event.data.fetchrFetchWorker.url);
        self.close();
    }
}
