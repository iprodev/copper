import type { SubtitleLang } from "$lib/settings/audio-sub-language";
import type { FetchrSettingsV5 } from "$lib/types/settings/v5";

export const youtubeVideoContainerOptions = ["auto", "mp4", "webm", "mkv"] as const;
export const localProcessingOptions = ["disabled", "preferred", "forced"] as const;

export type FetchrSettingsV6 = Omit<FetchrSettingsV5, 'schemaVersion' | 'save'> & {
    schemaVersion: 6,
    save: Omit<FetchrSettingsV5['save'], 'localProcessing'> & {
        localProcessing: typeof localProcessingOptions[number],
        youtubeVideoContainer: typeof youtubeVideoContainerOptions[number];
        subtitleLang: SubtitleLang,
    },
};
