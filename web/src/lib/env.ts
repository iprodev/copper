import * as _env from "$env/static/public";

const getEnv = (_key: string) => {
    const env = _env as Record<string, string | undefined>;
    const key = `WEB_${_key}`;

    if (key in env) {
        return env[key];
    }
}

const getEnvBool = (key: string) => {
    const value = getEnv(key);
    return value && ['1', 'true'].includes(value.toLowerCase());
}

const variables = {
    HOST: getEnv('HOST'),
    PLAUSIBLE_HOST: getEnv('PLAUSIBLE_HOST'),
    PLAUSIBLE_ENABLED: getEnv('HOST') && getEnv('PLAUSIBLE_HOST'),
    DEFAULT_API: getEnv('DEFAULT_API'),
    ENABLE_WEBCODECS: getEnvBool('ENABLE_WEBCODECS'),
    ENABLE_DEPRECATED_YOUTUBE_HLS: getEnvBool('ENABLE_DEPRECATED_YOUTUBE_HLS'),
}

const contacts = {
    github: "https://github.com/iprodev/fetchr",
}

const siriShortcuts = {
    photos: "https://www.icloud.com/shortcuts/80ea448d6d58478ea3062cd6171d0d61",
    files: "https://www.icloud.com/shortcuts/53d5f2cb165d4921951d3c70d2584fc0",
};

const docs = {
    instanceHosting: "https://github.com/iprodev/fetchr/blob/main/docs/run-an-instance.md",
    webLicense: "https://github.com/iprodev/fetchr/blob/main/web/LICENSE",
    apiLicense: "https://github.com/iprodev/fetchr/blob/main/api/LICENSE",
};

// fetchr is based on cobalt by imput, credited in the about section
const upstream = {
    project: "https://github.com/imputnet/cobalt",
};

const officialApiURL = "https://api.fetchr.download";

export { officialApiURL, contacts, siriShortcuts, docs, upstream };
export default variables;
