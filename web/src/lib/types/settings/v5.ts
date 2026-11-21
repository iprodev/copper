import { type FetchrSettingsV4 } from "$lib/types/settings/v4";

export type FetchrSettingsV5 = Omit<FetchrSettingsV4, 'schemaVersion' | 'advanced' | 'save' | 'privacy' | 'appearance'> & {
    schemaVersion: 5,
    appearance: Omit<FetchrSettingsV4['appearance'], 'reduceMotion' | 'reduceTransparency'> & {
        hideRemuxTab: boolean,
    },
    accessibility: {
        reduceMotion: boolean;
        reduceTransparency: boolean;
        disableHaptics: boolean;
        dontAutoOpenQueue: boolean;
    },
    advanced: FetchrSettingsV4['advanced'] & {
        useWebCodecs: boolean;
    },
    privacy: Omit<FetchrSettingsV4['privacy'], 'alwaysProxy'>,
    save: Omit<FetchrSettingsV4['save'], 'tiktokH265' | 'twitterGif'> & {
        alwaysProxy: boolean;
        localProcessing: boolean;
        allowH265: boolean;
        convertGif: boolean;
        youtubeBetterAudio: boolean;
    },
};
