import { readable, type Updater } from "svelte/store";

import { schedule } from "$lib/task-manager/scheduler";
import { clearFileStorage, removeFromFileStorage } from "$lib/storage/opfs";
import { clearCurrentTasks, removeWorkerFromQueue } from "$lib/state/task-manager/current-tasks";

import type { FetchrQueue, FetchrQueueItem, FetchrQueueItemRunning, UUID } from "$lib/types/queue";

const clearPipelineCache = (queueItem: FetchrQueueItem) => {
    if (queueItem.state === "running") {
        for (const [ workerId, item ] of Object.entries(queueItem.pipelineResults)) {
            removeFromFileStorage(item.name);
            delete queueItem.pipelineResults[workerId];
        }
    } else if (queueItem.state === "done") {
        removeFromFileStorage(queueItem.resultFile.name);
    }

    return queueItem;
}

let update: (_: Updater<FetchrQueue>) => void;

export const queue = readable<FetchrQueue>(
    {},
    (_, _update) => { update = _update }
);

export function addItem(item: FetchrQueueItem) {
    update(queueData => {
        queueData[item.id] = item;
        return queueData;
    });

    schedule();
}

export function itemError(id: UUID, workerId: UUID, error: string) {
    update(queueData => {
        if (queueData[id]) {
            queueData[id] = clearPipelineCache(queueData[id]);

            queueData[id] = {
                ...queueData[id],
                state: "error",
                errorCode: error,
            }
        }
        return queueData;
    });

    removeWorkerFromQueue(workerId);
    schedule();
}

export function itemDone(id: UUID, file: File) {
    update(queueData => {
        if (queueData[id]) {
            queueData[id] = clearPipelineCache(queueData[id]);

            queueData[id] = {
                ...queueData[id],
                state: "done",
                resultFile: file,
            }
        }
        return queueData;
    });

    schedule();
}

export function pipelineTaskDone(id: UUID, workerId: UUID, file: File) {
    update(queueData => {
        const item = queueData[id];

        if (item && item.state === 'running') {
            item.pipelineResults[workerId] = file;
        } else {
            // the task was restarted or removed meanwhile, the file isn't needed
            removeFromFileStorage(file.name);
        }

        return queueData;
    });

    removeWorkerFromQueue(workerId);
    schedule();
}

export function itemRunning(id: UUID) {
    update(queueData => {
        const data = queueData[id] as FetchrQueueItemRunning;

        if (data) {
            data.state = 'running';
            data.pipelineResults ??= {};
        }

        return queueData;
    });

    schedule();
}

// the task waits for new tunnels from the api, see task-manager/recovery.ts
export function itemRefreshing(id: UUID) {
    update(queueData => {
        const item = queueData[id];

        if (item) {
            clearPipelineCache(item);
            queueData[id] = {
                ...item,
                state: "waiting",
                refreshing: true,
            } as FetchrQueueItem;
        }

        return queueData;
    });
}

export function removeItem(id: UUID) {
    update(queueData => {
        const item = queueData[id];

        for (const worker of item.pipeline) {
            removeWorkerFromQueue(worker.workerId);
        }
        clearPipelineCache(item);

        delete queueData[id];
        return queueData;
    });

    schedule();
}

export function clearQueue() {
    update(() => ({}));
    clearCurrentTasks();
    clearFileStorage();
}
