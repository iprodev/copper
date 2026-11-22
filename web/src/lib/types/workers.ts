import type { FileInfo } from "$lib/types/libav";
import type { UUID } from "./queue";

export const resultFileTypes = ["video", "audio", "image", "file"] as const;

export type FetchrPipelineResultFileType = typeof resultFileTypes[number];

export type FetchrWorkerProgress = {
    percentage?: number,
    speed?: number,
    size: number,
};

type FetchrFFmpegWorkerArgs = {
    files: File[],
    ffargs: string[],
    output: FileInfo,
};

type FetchrPipelineItemBase = {
    workerId: UUID,
    parentId: UUID,
    dependsOn?: UUID[],
};

type FetchrRemuxPipelineItem = FetchrPipelineItemBase & {
    worker: "remux",
    workerArgs: FetchrFFmpegWorkerArgs,
}

type FetchrEncodePipelineItem = FetchrPipelineItemBase & {
    worker: "encode",
    workerArgs: FetchrFFmpegWorkerArgs,
}

type FetchrFetchPipelineItem = FetchrPipelineItemBase & {
    worker: "fetch",
    workerArgs: { url: string },
}

export type FetchrPipelineItem = FetchrEncodePipelineItem
                               | FetchrRemuxPipelineItem
                               | FetchrFetchPipelineItem;
