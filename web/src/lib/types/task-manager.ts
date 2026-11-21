import type { FetchrPipelineItem, FetchrWorkerProgress } from "$lib/types/workers";
import type { UUID } from "./queue";

export type FetchrCurrentTaskItem = {
    type: FetchrPipelineItem['worker'],
    parentId: UUID,
    progress?: FetchrWorkerProgress,
}

export type FetchrCurrentTasks = {
    [id: UUID]: FetchrCurrentTaskItem,
}
