// what happens when a task of the processing queue fails:
// - tunnels expire (90 seconds by default), so tasks that waited too long
//   in the queue get new ones from the api before they start.
// - when processing in the browser fails, the same request is sent to the
//   server with local processing off, and the server does the job.
// - everything else is shown as an error, as before.

import { get } from "svelte/store";

import API from "$lib/api/api";
import { downloadFile } from "$lib/download";
import { createSavePipeline } from "$lib/task-manager/queue";
import { queue, itemError, removeItem, itemRefreshing } from "$lib/state/task-manager/queue";

import type { FetchrQueueItem, UUID } from "$lib/types/queue";
import type { FetchrSaveRequestBody } from "$lib/types/api";

// tunnels that expire sooner than this are replaced before a task starts
// (or sooner than half their lifetime, for servers with short-lived tunnels)
const EXPIRY_MARGIN = 20 * 1000;

// new tunnels are asked for at most this many times per task
const MAX_REFRESHES = 3;

// failures of the browser's own processing, which the server can do instead
const LOCAL_FAILURES = new Set([
    "queue.worker_didnt_start",
    "queue.generic_error",
    "queue.fetch.crashed",
    "queue.fetch.no_file_reader",
    // the server streams the file without keeping it anywhere
    "queue.fetch.no_space",
    // e.g. a live stream, or encryption the browser can't undo
    "queue.fetch.hls_unsupported",
    "queue.ffmpeg.probe_failed",
    "queue.ffmpeg.out_of_memory",
    "queue.ffmpeg.no_input_format",
    "queue.ffmpeg.no_input_type",
    "queue.ffmpeg.crashed",
    "queue.ffmpeg.no_render",
    "queue.ffmpeg.no_args",
]);

// statuses of a tunnel that expired or doesn't exist anymore
const EXPIRED_STATUSES = new Set([401, 403, 404]);

const expiresAt = (url: string) => {
    try {
        return Number(new URL(url).searchParams.get("exp")) || Infinity;
    } catch {
        return Infinity;
    }
}

export const tunnelsExpireSoon = (item: FetchrQueueItem) => {
    const now = Date.now();

    return item.pipeline.some(worker => {
        if (worker.worker !== "fetch") return false;

        const expiry = expiresAt(worker.workerArgs.url);
        const lifetime = item.createdAt ? expiry - item.createdAt : Infinity;

        return expiry - now < Math.min(EXPIRY_MARGIN, lifetime / 2);
    });
}

export const canRefresh = (item: FetchrQueueItem) =>
    !!item.originalRequest && (item.refreshes ?? 0) < MAX_REFRESHES;

const apiErrorCode = (code?: string) =>
    // api codes look like "error.api.fetch.empty", queue items show "error.<code>"
    code ? code.replace(/^error\./, "") : "api.generic";

// asks the api for the same file again, with new tunnels.
// the task keeps its place in the queue.
export const refreshItem = async (id: UUID) => {
    const item = get(queue)[id];
    if (!item?.originalRequest || item.refreshing) return;

    itemRefreshing(id);

    const request = item.originalRequest;
    const response = await API.request(request).catch(() => undefined);
    const firstWorker = item.pipeline[0]?.workerId;

    if (response?.status === "local-processing") {
        return createSavePipeline(response, request, id, {
            quiet: true,
            refreshes: (item.refreshes ?? 0) + 1,
        });
    }

    // the server decided to process it itself this time
    if (response?.status === "tunnel" || response?.status === "redirect") {
        removeItem(id);
        return downloadFile({
            url: response.url,
            urlType: response.status === "redirect" ? "redirect" : undefined,
        });
    }

    return itemError(
        id, firstWorker,
        response?.status === "error" ? apiErrorCode(response.error?.code) : "api.unreachable",
    );
}

// sends the request to the server with local processing off
const fallbackToServer = async (item: FetchrQueueItem, workerId: UUID, code: string) => {
    const request: FetchrSaveRequestBody = {
        ...item.originalRequest!,
        localProcessing: "disabled",
    };

    const response = await API.request(request).catch(() => undefined);

    if (response?.status === "tunnel" || response?.status === "redirect") {
        removeItem(item.id);
        return downloadFile({
            url: response.url,
            urlType: response.status === "redirect" ? "redirect" : undefined,
        });
    }

    // the server can't do it either (or insists on local processing)
    return itemError(item.id, workerId, code);
}

// called instead of itemError() when a worker fails
export const handleFailure = (parentId: UUID, workerId: UUID, code: string, status?: number) => {
    const item = get(queue)[parentId];

    if (!item?.originalRequest) {
        return itemError(parentId, workerId, code);
    }

    // the tunnel expired while the task was running: get new ones
    if (code === "queue.fetch.bad_response" && status && EXPIRED_STATUSES.has(status) && canRefresh(item)) {
        return refreshItem(parentId);
    }

    if (LOCAL_FAILURES.has(code) && item.originalRequest.localProcessing !== "disabled") {
        return fallbackToServer(item, workerId, code);
    }

    return itemError(parentId, workerId, code);
}
