// client for the fetchr api

export class FetchrClient {
    #apiUrl;
    #apiKey;
    #fetch;
    #publicUrl;

    constructor({ apiUrl, apiKey, fetch = globalThis.fetch }) {
        this.#apiUrl = new URL(apiUrl).toString();
        this.#apiKey = apiKey;
        this.#fetch = fetch;
    }

    // reads the instance's public url, used to reach tunnels internally
    async init() {
        const response = await this.#fetch(this.#apiUrl, {
            signal: AbortSignal.timeout(10000),
        });
        const info = await response.json();

        this.#publicUrl = info?.fetchr?.url;
        return info;
    }

    async request(url, { downloadMode = "auto", videoQuality = "720" } = {}) {
        const headers = {
            "accept": "application/json",
            "content-type": "application/json",
        };

        if (this.#apiKey) {
            headers.authorization = `Api-Key ${this.#apiKey}`;
        }

        const response = await this.#fetch(this.#apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                url,
                downloadMode,
                videoQuality,
                audioFormat: "mp3",
                filenameStyle: "basic",
                youtubeVideoCodec: "h264",
                localProcessing: "disabled",
                // files always come through the instance, which knows the
                // headers (and proxies) each service needs
                alwaysProxy: true,
            }),
            signal: AbortSignal.timeout(60000),
        });

        return response.json();
    }

    // tunnel links point to the public url of the instance. the bot usually
    // runs next to it, so tunnels are fetched through the internal url.
    internalURL(url) {
        if (!this.#publicUrl) return url;

        const target = new URL(url);
        if (target.origin !== new URL(this.#publicUrl).origin) return url;

        const internal = new URL(this.#apiUrl);
        target.protocol = internal.protocol;
        target.host = internal.host;
        return target.toString();
    }
}
