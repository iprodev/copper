import * as Storage from "$lib/storage";

import type { AbstractStorage } from "$lib/storage/storage";

const networkErrors = [
    "TypeError: Failed to fetch",
    "TypeError: network error",
];

// tries after the first one, for network problems and server errors
const RETRIES = 3;

// progress is reported at most this often
const PROGRESS_INTERVAL = 250;

type Attempt =
    | { file: File }
    | { error: string, retry: boolean, status?: number };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// a failed attempt leaves nothing behind in the browser's storage
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

const attempt = async (url: string): Promise<Attempt> => {
    let storage: AbstractStorage | undefined;

    try {
        const response = await fetch(url);

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

        const contentType = response.headers.get('Content-Type')
                                || 'application/octet-stream';

        const contentLength = response.headers.get('Content-Length');
        const estimatedLength = response.headers.get('Estimated-Content-Length');

        let expectedSize;

        if (contentLength) {
            expectedSize = +contentLength;
        } else if (estimatedLength) {
            expectedSize = +estimatedLength;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            return { error: "queue.fetch.no_file_reader", retry: false };
        }

        storage = await Storage.init(expectedSize);

        let receivedBytes = 0;
        let lastProgress = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            await storage.write(value, receivedBytes);
            receivedBytes += value.length;

            if (expectedSize && Date.now() - lastProgress > PROGRESS_INTERVAL) {
                lastProgress = Date.now();
                self.postMessage({
                    fetchrFetchWorker: {
                        progress: Math.round((receivedBytes / expectedSize) * 100),
                        size: receivedBytes,
                    }
                });
            }
        }

        if (receivedBytes === 0) {
            await discard(storage);
            return { error: "queue.fetch.empty_tunnel", retry: true };
        }

        const file = Storage.retype(await storage.res(), contentType);

        if (contentLength && Number(contentLength) !== file.size) {
            await discard(storage);
            return { error: "queue.fetch.corrupted_file", retry: true };
        }

        return { file };
    } catch (e) {
        await discard(storage);

        // network problems are worth another try
        if (networkErrors.includes(String(e))) {
            return { error: "queue.fetch.network_error", retry: true };
        }

        console.error("error from the fetch worker:");
        console.error(e);
        return { error: "queue.fetch.crashed", retry: false };
    }
}

const fetchFile = async (url: string) => {
    for (let i = 0; i <= RETRIES; i++) {
        const result = await attempt(url);

        if ("file" in result) {
            self.postMessage({
                fetchrFetchWorker: {
                    result: result.file
                }
            });
            return;
        }

        if (!result.retry || i === RETRIES) {
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
