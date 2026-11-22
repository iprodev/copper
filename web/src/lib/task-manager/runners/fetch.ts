import FetchWorker from "$lib/task-manager/workers/fetch?worker";

import { killWorker } from "$lib/task-manager/run-worker";
import { updateWorkerProgress } from "$lib/state/task-manager/current-tasks";
import { pipelineTaskDone, queue } from "$lib/state/task-manager/queue";
import { handleFailure } from "$lib/task-manager/recovery";

import type { FetchrQueue, UUID } from "$lib/types/queue";

export const runFetchWorker = async (workerId: UUID, parentId: UUID, url: string) => {
    const worker = new FetchWorker();

    const unsubscribe = queue.subscribe((queue: FetchrQueue) => {
        if (!queue[parentId]) {
            killWorker(worker, unsubscribe);
        }
    });

    worker.postMessage({
        fetchrFetchWorker: {
            url
        }
    });

    worker.onmessage = (event) => {
        const eventData = event.data.fetchrFetchWorker;
        if (!eventData) return;

        if (eventData.progress) {
            updateWorkerProgress(workerId, {
                percentage: eventData.progress,
                size: eventData.size,
            })
        }

        if (eventData.result) {
            killWorker(worker, unsubscribe);
            return pipelineTaskDone(
                parentId,
                workerId,
                eventData.result,
            );
        }

        if (eventData.error) {
            killWorker(worker, unsubscribe);
            return handleFailure(parentId, workerId, eventData.error, eventData.status);
        }
    }
}
