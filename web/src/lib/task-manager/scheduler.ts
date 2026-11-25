import { get } from "svelte/store";
import { startWorker } from "$lib/task-manager/run-worker";
import { addWorkerToQueue, currentTasks } from "$lib/state/task-manager/current-tasks";
import { itemDone, itemError, itemRunning, queue } from "$lib/state/task-manager/queue";
import { canRefresh, refreshItem, tunnelsExpireSoon } from "$lib/task-manager/recovery";

import type { FetchrPipelineItem } from "$lib/types/workers";

// downloading uses the network, processing (ffmpeg) uses the cpu, so the
// next task can download while the one before it is being processed.
// at most this many tasks run at once: one downloading, one processing.
const MAX_RUNNING = 2;

type Stage = "fetch" | "process";

const stageOf = (worker: FetchrPipelineItem["worker"]): Stage =>
    worker === "fetch" ? "fetch" : "process";

const startPipeline = (pipelineItem: FetchrPipelineItem) => {
    addWorkerToQueue(pipelineItem.workerId, {
        type: pipelineItem.worker,
        parentId: pipelineItem.parentId,
    });

    itemRunning(pipelineItem.parentId);
    startWorker(pipelineItem);
}

// starts at most one worker per call. starting a worker (or finishing a
// task) changes the queue, which calls schedule() again for the next one.
export const schedule = () => {
    const queueItems = Object.values(get(queue));
    const ongoing = Object.values(get(currentTasks));

    // tasks that are downloading right now, and whether anything is being processed
    const fetching = new Set(
        ongoing.filter(task => stageOf(task.type) === "fetch").map(task => task.parentId)
    );
    const processing = ongoing.some(task => stageOf(task.type) === "process");
    const running = queueItems.filter(task => task.state === "running").length;

    for (const task of queueItems) {
        if (task.state === "running") {
            const finalWorker = task.pipeline[task.pipeline.length - 1];

            // if all workers are completed, return the final file
            if (Object.keys(task.pipelineResults).length === task.pipeline.length) {
                // remove the final file from pipeline results, so that it doesn't
                // get deleted when we clean up the intermediate files
                const finalFile = task.pipelineResults[finalWorker.workerId];
                delete task.pipelineResults[finalWorker.workerId];

                if (finalFile) {
                    itemDone(task.id, finalFile);
                } else {
                    itemError(task.id, finalWorker.workerId, "queue.no_final_file");
                }

                return;
            }

            for (const worker of task.pipeline) {
                if (task.pipelineResults[worker.workerId] || get(currentTasks)[worker.workerId]) {
                    continue;
                }

                // e.g. ffmpeg waits for all downloads of its task
                if (worker.dependsOn?.some(id => !task.pipelineResults[id])) {
                    break;
                }

                const stage = stageOf(worker.worker);

                // downloads of the same task run together, other tasks wait
                if (stage === "fetch" && fetching.size && !fetching.has(task.id)) break;
                if (stage === "process" && processing) break;

                startPipeline(worker);
                return;
            }

            // this task waits, a later one might be able to go ahead
            continue;
        }

        if (task.state === "waiting" && task.pipeline.length > 0) {
            // tasks start in the order they were added, so the first waiting
            // task decides: if it can't start yet, nothing after it does
            const stage = stageOf(task.pipeline[0].worker);

            if (running >= MAX_RUNNING) return;
            if (stage === "fetch" && fetching.size) return;
            if (stage === "process" && processing) return;

            // new tunnels are on their way, this task starts once they're here
            if (task.refreshing) return;

            // the tunnels of a task that waited long in the queue have expired
            // (or are about to): new ones are requested first
            if (tunnelsExpireSoon(task) && canRefresh(task)) {
                refreshItem(task.id);
                return;
            }

            startPipeline(task.pipeline[0]);
            return;
        }
    }
}
