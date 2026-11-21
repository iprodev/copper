import { readonly, writable } from "svelte/store";

import type { FetchrWorkerProgress } from "$lib/types/workers";
import type { FetchrCurrentTasks, FetchrCurrentTaskItem } from "$lib/types/task-manager";

const currentTasks_ = writable<FetchrCurrentTasks>({});
export const currentTasks = readonly(currentTasks_);

export function addWorkerToQueue(workerId: string, item: FetchrCurrentTaskItem) {
    currentTasks_.update(tasks => {
        tasks[workerId] = item;
        return tasks;
    });
}

export function removeWorkerFromQueue(id: string) {
    currentTasks_.update(tasks => {
        delete tasks[id];
        return tasks;
    });
}

export function updateWorkerProgress(workerId: string, progress: FetchrWorkerProgress) {
    currentTasks_.update(allTasks => {
        allTasks[workerId].progress = progress;
        return allTasks;
    });
}

export function clearCurrentTasks() {
    currentTasks_.set({});
}
