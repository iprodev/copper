import type { FetchrSaveRequestBody } from "$lib/types/api";
import type { FetchrPipelineItem, FetchrPipelineResultFileType } from "$lib/types/workers";

export type UUID = string;

type FetchrQueueBaseItem = {
    id: UUID,
    pipeline: FetchrPipelineItem[],
    canRetry?: boolean,
    originalRequest?: FetchrSaveRequestBody,
    filename: string,
    mimeType?: string,
    mediaType: FetchrPipelineResultFileType,
};

type FetchrQueueItemWaiting = FetchrQueueBaseItem & {
    state: "waiting",
};

export type FetchrQueueItemRunning = FetchrQueueBaseItem & {
    state: "running",
    pipelineResults: Record<UUID, File>,
};

type FetchrQueueItemDone = FetchrQueueBaseItem & {
    state: "done",
    resultFile: File,
};

type FetchrQueueItemError = FetchrQueueBaseItem & {
    state: "error",
    errorCode: string,
};

export type FetchrQueueItem = FetchrQueueItemWaiting
                            | FetchrQueueItemRunning
                            | FetchrQueueItemDone
                            | FetchrQueueItemError;

export type FetchrQueue = {
    [id: UUID]: FetchrQueueItem,
};
