import FFmpegWorker from "$lib/task-manager/workers/ffmpeg?worker";

import { killWorker } from "$lib/task-manager/run-worker";
import { updateWorkerProgress } from "$lib/state/task-manager/current-tasks";
import { pipelineTaskDone, queue } from "$lib/state/task-manager/queue";
import { handleFailure } from "$lib/task-manager/recovery";

import type { FileInfo } from "$lib/types/libav";
import type { FetchrQueue } from "$lib/types/queue";

let startAttempts = 0;

export const runFFmpegWorker = async (
    workerId: string,
    parentId: string,
    files: File[],
    args: string[],
    output: FileInfo,
    variant: 'remux' | 'encode',
    yesthreads: boolean,
    resetStartCounter = false,
) => {
    const worker = new FFmpegWorker();

    // sometimes chrome refuses to start libav wasm,
    // so we check if it started, try 2 more times if not, and give up after that.
    // a task that can't be processed in the browser goes to the server instead
    // (see task-manager/recovery.ts), so there's no need to keep trying for long
    // TODO: fix the underlying issue because this is ridiculous

    if (resetStartCounter) startAttempts = 0;

    let bumpAttempts = 0;
    const startCheck = setInterval(async () => {
        bumpAttempts++;

        if (bumpAttempts === 10) {
            startAttempts++;
            if (startAttempts <= 2) {
                killWorker(worker, unsubscribe, startCheck);
                return await runFFmpegWorker(
                    workerId, parentId,
                    files, args, output,
                    variant, yesthreads
                );
            } else {
                killWorker(worker, unsubscribe, startCheck);
                return handleFailure(parentId, workerId, "queue.worker_didnt_start");
            }
        }
    }, 500);

    const unsubscribe = queue.subscribe((queue: FetchrQueue) => {
        if (!queue[parentId]) {
            killWorker(worker, unsubscribe, startCheck);
        }
    });

    worker.postMessage({
        fetchrFFmpegWorker: {
            variant,
            files,
            args,
            output,
            yesthreads,
        }
    });

    worker.onerror = (e) => {
        console.error("ffmpeg worker crashed:", e);
        killWorker(worker, unsubscribe, startCheck);

        return handleFailure(parentId, workerId, "queue.generic_error");
    };

    let totalDuration: number | null = null;

    worker.onmessage = (event) => {
        const eventData = event.data.fetchrFFmpegWorker;
        if (!eventData) return;

        clearInterval(startCheck);

        if (eventData.progress) {
            if (eventData.progress.duration) {
                totalDuration = eventData.progress.duration;
            }

            updateWorkerProgress(workerId, {
                percentage: totalDuration ? (eventData.progress.durationProcessed / totalDuration) * 100 : 0,
                size: eventData.progress.size,
            })
        }

        if (eventData.render) {
            killWorker(worker, unsubscribe, startCheck);
            return pipelineTaskDone(
                parentId,
                workerId,
                eventData.render,
            );
        }

        if (eventData.error) {
            killWorker(worker, unsubscribe, startCheck);
            return handleFailure(parentId, workerId, eventData.error);
        }
    };
}
