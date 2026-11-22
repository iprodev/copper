import { type FetchrSettingsV3 } from "$lib/types/settings/v3";

export type FetchrSettingsV4 = Omit<FetchrSettingsV3, 'schemaVersion' | 'processing'> & {
    schemaVersion: 4,
    processing: Omit<FetchrSettingsV3['processing'], 'allowDefaultOverride' | 'seenOverrideWarning'> & {
        customApiKey: string;
        enableCustomApiKey: boolean;
    };
};
