import type { YoutubeDubLang } from "$lib/settings/audio-sub-language";
import { type FetchrSettingsV2 } from "$lib/types/settings/v2";

export type FetchrSettingsV3 = Omit<FetchrSettingsV2, 'schemaVersion' | 'save'> & {
    schemaVersion: 3,
    save: Omit<FetchrSettingsV2['save'], 'youtubeDubBrowserLang'> & {
        youtubeDubLang: YoutubeDubLang;
    };
};
