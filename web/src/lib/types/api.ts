import type { FetchrSettings } from "$lib/types/settings";

enum FetchrResponseType {
    Error = 'error',
    Picker = 'picker',
    Redirect = 'redirect',
    Tunnel = 'tunnel',
    LocalProcessing = 'local-processing',
}

export type FetchrErrorResponse = {
    status: FetchrResponseType.Error,
    error: {
        code: string,
        context?: {
            service?: string,
            limit?: number,
        }
    },
};

type FetchrPartialURLResponse = {
    url: string,
    filename: string,
}

type FetchrPickerResponse = {
    status: FetchrResponseType.Picker
    picker: {
        type: 'photo' | 'video' | 'gif',
        url: string,
        thumb?: string,
    }[];
    audio?: string,
    audioFilename?: string,
};

type FetchrRedirectResponse = {
    status: FetchrResponseType.Redirect,
} & FetchrPartialURLResponse;

type FetchrTunnelResponse = {
    status: FetchrResponseType.Tunnel,
} & FetchrPartialURLResponse;

export const FetchrFileMetadataKeys = [
    'album',
    'composer',
    'genre',
    'copyright',
    'title',
    'artist',
    'album_artist',
    'track',
    'date',
    'sublanguage',
];

export type FetchrFileMetadata = Record<
    typeof FetchrFileMetadataKeys[number], string | undefined
>;

export type FetchrLocalProcessingType = 'merge' | 'mute' | 'audio' | 'gif' | 'remux' | 'proxy';

export type FetchrLocalProcessingResponse = {
    status: FetchrResponseType.LocalProcessing,

    type: FetchrLocalProcessingType,
    service: string,
    tunnel: string[],

    output: {
        type: string, // mimetype
        filename: string,
        metadata?: FetchrFileMetadata,
        subtitles?: boolean,
    },

    audio?: {
        copy: boolean,
        format: string,
        bitrate: string,
        cover?: boolean,
        cropCover?: boolean,
    },

    isHLS?: boolean,
}

export type FetchrFileUrlType = "redirect" | "tunnel";

export type FetchrSession = {
    token: string,
    exp: number,
}

export type FetchrServerInfo = {
    fetchr: {
        version: string,
        url: string,
        startTime: string,
        turnstileSitekey?: string,
        services: string[]
    },
    git: {
        branch: string,
        commit: string,
        remote: string,
    }
}

// TODO: strict partial
// this allows for extra properties, which is not ideal,
// but i couldn't figure out how to make a strict partial :(
export type FetchrSaveRequestBody =
    { url: string, localEncoding?: boolean, localHLS?: boolean } & Partial<Omit<FetchrSettings['save'], 'savingMethod'>>;

export type FetchrSessionResponse = FetchrSession | FetchrErrorResponse;
export type FetchrServerInfoResponse = FetchrServerInfo | FetchrErrorResponse;

export type FetchrAPIResponse = FetchrErrorResponse
                              | FetchrPickerResponse
                              | FetchrRedirectResponse
                              | FetchrTunnelResponse
                              | FetchrLocalProcessingResponse;
