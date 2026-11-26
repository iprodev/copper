import env from "$lib/env";
import API from "$lib/api/api";
import settings from "$lib/state/settings";
import lazySettingGetter from "$lib/settings/lazy-get";

import { get } from "svelte/store";
import { device } from "$lib/device";
import { t } from "$lib/i18n/translations";
import { downloadFile } from "$lib/download";
import { createDialog } from "$lib/state/dialogs";
import { downloadButtonState } from "$lib/state/omnibox";
import { createSavePipeline } from "$lib/task-manager/queue";

import type { FetchrSaveRequestBody } from "$lib/types/api";

type SavingHandlerArgs = {
    url?: string,
    request?: FetchrSaveRequestBody,
    oldTaskId?: string
}

export const savingHandler = async ({ url, request, oldTaskId }: SavingHandlerArgs) => {
    downloadButtonState.set("think");

    const error = (errorText: string) => {
        return createDialog({
            id: "save-error",
            type: "small",
            mascot: "error",
            buttons: [
                {
                    text: get(t)("button.gotit"),
                    main: true,
                    action: () => {},
                },
            ],
            bodyText: errorText,
        });
    }

    const getSetting = lazySettingGetter(get(settings));

    if (!request && !url) return;

    const localProcessing = get(settings).save.localProcessing;

    const selectedRequest = request || {
        url: url!,

        // not lazy cuz default depends on device capabilities.
        // on iphones and ipads, a file the browser downloaded itself is shared
        // as a file ("save video" in the share sheet), but a link to the
        // server is shared as a link. so with local processing on, the browser
        // downloads every file itself there, even ones that need no processing.
        localProcessing: device.is.iOS && localProcessing === "preferred"
            ? "forced"
            : localProcessing,

        // devices that shouldn't convert files locally only merge and remux
        ...(device.supports.localEncoding ? {} : { localEncoding: false }),

        // hls streams can be downloaded by the browser too
        localHLS: true,

        alwaysProxy: getSetting("save", "alwaysProxy"),
        downloadMode: getSetting("save", "downloadMode"),

        subtitleLang: getSetting("save", "subtitleLang"),
        filenameStyle: getSetting("save", "filenameStyle"),
        disableMetadata: getSetting("save", "disableMetadata"),

        audioFormat: getSetting("save", "audioFormat"),
        audioBitrate: getSetting("save", "audioBitrate"),
        tiktokFullAudio: getSetting("save", "tiktokFullAudio"),
        youtubeDubLang: getSetting("save", "youtubeDubLang"),
        youtubeBetterAudio: getSetting("save", "youtubeBetterAudio"),

        videoQuality: getSetting("save", "videoQuality"),
        youtubeVideoCodec: getSetting("save", "youtubeVideoCodec"),
        youtubeVideoContainer: getSetting("save", "youtubeVideoContainer"),
        youtubeHLS: env.ENABLE_DEPRECATED_YOUTUBE_HLS ? getSetting("save", "youtubeHLS") : undefined,

        allowH265: getSetting("save", "allowH265"),
        convertGif: getSetting("save", "convertGif"),
    }

    const response = await API.request(selectedRequest);

    if (!response) {
        downloadButtonState.set("error");
        return error(get(t)("error.api.unreachable"));
    }

    if (response.status === "error") {
        downloadButtonState.set("error");

        return error(
            get(t)(response.error.code, response?.error?.context)
        );
    }

    if (response.status === "redirect") {
        downloadButtonState.set("done");

        return downloadFile({
            url: response.url,
            urlType: "redirect",
        });
    }

    if (response.status === "tunnel") {
        downloadButtonState.set("check");

        const probeResult = await API.probeFetchrTunnel(response.url);

        if (probeResult === 200) {
            downloadButtonState.set("done");

            return downloadFile({
                url: response.url,
            });
        } else {
            downloadButtonState.set("error");
            return error(get(t)("error.tunnel.probe"));
        }
    }

    if (response.status === "local-processing") {
        downloadButtonState.set("done");
        return createSavePipeline(response, selectedRequest, oldTaskId);
    }

    if (response.status === "picker") {
        downloadButtonState.set("done");
        const buttons = [
            {
                text: get(t)("button.done"),
                main: true,
                action: () => { },
            },
        ];

        if (response.audio) {
            const pickerAudio = response.audio;
            buttons.unshift({
                text: get(t)("button.download.audio"),
                main: false,
                action: () => {
                    downloadFile({
                        url: pickerAudio,
                    });
                },
            });
        }

        return createDialog({
            id: "download-picker",
            type: "picker",
            items: response.picker,
            buttons,
        });
    }

    downloadButtonState.set("error");
    return error(get(t)("error.api.unknown_response"));
}
