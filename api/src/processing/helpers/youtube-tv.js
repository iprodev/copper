// links of the tv client, for videos whose ios client links googlevideo
// refuses (403 on HEAD, and on everything after roughly the first minute of
// the file), which left those videos as empty files.
//
// it does what yt-dlp does: asks for the video as a tv ("tv_samsung"
// client), solves the n/sig challenges of the tv variant of the player with
// yt-dlp's challenge solver (./ejs, https://github.com/yt-dlp/ejs), and
// waits until youtube's pre-roll ad would be over, because the links only
// work after that (about 6 seconds).

import ivm from "isolated-vm";
import { readFileSync } from "node:fs";
import { fetch } from "undici";

const TV_CLIENT = {
    clientName: "TVHTML5",
    clientVersion: "5.20260707",
    deviceMake: "Samsung",
    deviceModel: "UKS9800",
    userAgent: "Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1",
    osName: "Tizen",
    osVersion: "2.4.0",
    hl: "en",
    timeZone: "UTC",
    utcOffsetMinutes: 0,
};
const TV_CLIENT_ID = "7";

// longest pre-roll ad wait we accept, in seconds
const MAX_AD_WAIT = 45;

const ejsDir = new URL("./ejs/", import.meta.url);
let ejs;
const loadEjs = () => {
    ejs ??= {
        lib: readFileSync(new URL("lib.min.js", ejsDir), "utf8"),
        core: readFileSync(new URL("core.min.js", ejsDir), "utf8"),
    };
    return ejs;
}

// the tv variant of the current player, and the solver's preprocessed
// version of it (much faster to solve with), for the latest player id
let cachedPlayer;

const getPlayer = async (playerId, dispatcher) => {
    if (cachedPlayer?.id === playerId) return cachedPlayer;

    const res = await fetch(
        `https://www.youtube.com/s/player/${playerId}/tv-player-ias.vflset/tv-player-ias.js`,
        { dispatcher }
    );
    if (!res.ok) throw new Error(`tv player answered ${res.status}`);

    cachedPlayer = { id: playerId, js: await res.text() };
    return cachedPlayer;
}

// runs yt-dlp's solver in its own v8 isolate, away from the api
export const runSolver = async (input) => {
    const { lib, core } = loadEjs();
    const isolate = new ivm.Isolate({ memoryLimit: 512 });

    try {
        const context = await isolate.createContext();
        await context.global.set("__input", JSON.stringify(input));

        const script = await isolate.compileScript(
            `${lib}\nObject.assign(globalThis, lib);\n${core}\n` +
            `JSON.stringify(jsc(JSON.parse(__input)));`
        );

        return JSON.parse(await script.run(context, { timeout: 30000 }));
    } catch (e) {
        // the solver throws strings too (e.g. for a player it doesn't know)
        throw new Error(`challenge solver: ${e?.message ?? e}`);
    } finally {
        isolate.dispose();
    }
}

const solve = async (player, n, sig) => {
    const requests = [{ type: "n", challenges: n }];
    if (sig.length) requests.push({ type: "sig", challenges: sig });

    const input = player.preprocessed
        ? { type: "preprocessed", preprocessed_player: player.preprocessed, requests }
        : { type: "player", player: player.js, requests, output_preprocessed: true };

    const output = await runSolver(input);
    if (output.type === "error") {
        throw new Error(`challenge solver: ${output.error}`);
    }

    if (output.preprocessed_player) {
        player.preprocessed = output.preprocessed_player;
    }

    const [ nResult, sigResult ] = output.responses;
    if (nResult?.type === "error" || sigResult?.type === "error") {
        throw new Error(`challenge solver: ${nResult?.error ?? sigResult?.error}`);
    }

    return { n: nResult.data, sig: sigResult?.data ?? {} };
}

// seconds of pre-roll ads, like yt-dlp's _get_available_at_timestamp
export const adSeconds = (playerResponse) => {
    const renderers = [];

    for (const placement of playerResponse.adPlacements ?? []) {
        const renderer = placement?.adPlacementRenderer;
        if (renderer?.config?.adPlacementConfig?.kind === "AD_PLACEMENT_KIND_START") {
            renderers.push(renderer.renderer?.instreamVideoAdRenderer);
        }
    }

    for (const slot of playerResponse.adSlots ?? []) {
        const renderer = slot?.adSlotRenderer;
        if (renderer?.adSlotMetadata?.triggerEvent !== "SLOT_TRIGGER_EVENT_BEFORE_CONTENT") continue;

        const content = renderer.fulfillmentContent?.fulfilledLayout
            ?.playerBytesAdLayoutRenderer?.renderingContent;

        renderers.push(content?.instreamVideoAdRenderer);
        for (const layout of content?.playerBytesSequentialLayoutRenderer?.sequentialLayouts ?? []) {
            renderers.push(layout?.playerBytesAdLayoutRenderer?.renderingContent?.instreamVideoAdRenderer);
        }
    }

    let seconds = 0;
    for (const ad of renderers) {
        if (!ad) continue;

        const skip = ad.skipOffsetMilliseconds ? Number(ad.skipOffsetMilliseconds) / 1000 : undefined;
        const length = Number(new URLSearchParams(ad.playerVars ?? "").get("length_seconds")) || undefined;
        seconds += skip ?? length ?? 0;
    }

    return seconds;
}

// the link of a format, and its signature challenge if it has one
export const parseFormat = (format) => {
    if (format.url) {
        return { url: new URL(format.url) };
    }

    const cipher = new URLSearchParams(format.signatureCipher ?? format.cipher ?? "");
    if (!cipher.get("url")) return;

    return {
        url: new URL(cipher.get("url")),
        s: cipher.get("s"),
        sp: cipher.get("sp") || "signature",
    };
}

// returns working links for the same formats (by itag & audio track),
// or nothing if the tv client can't help
export const getTvUrls = async ({ id, formats, innertube, dispatcher }) => {
    const playerId = innertube?.session?.player?.player_id;
    const signatureTimestamp = innertube?.session?.player?.signature_timestamp;
    const visitorData = innertube?.session?.context?.client?.visitorData;

    if (!playerId || !signatureTimestamp) return;

    const requestedAt = Date.now();

    const response = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        dispatcher,
        headers: {
            "user-agent": TV_CLIENT.userAgent,
            "content-type": "application/json",
            "x-youtube-client-name": TV_CLIENT_ID,
            "x-youtube-client-version": TV_CLIENT.clientVersion,
            "origin": "https://www.youtube.com",
            ...(visitorData ? { "x-goog-visitor-id": visitorData } : {}),
        },
        body: JSON.stringify({
            context: { client: TV_CLIENT },
            videoId: id,
            playbackContext: {
                contentPlaybackContext: {
                    html5Preference: "HTML5_PREF_WANTS",
                    signatureTimestamp,
                },
            },
            contentCheckOk: true,
            racyCheckOk: true,
        }),
    });

    if (!response.ok) return;

    const playerResponse = await response.json();
    if (playerResponse?.playabilityStatus?.status !== "OK") return;

    const wait = adSeconds(playerResponse);
    if (wait > MAX_AD_WAIT) return;

    const available = playerResponse.streamingData?.adaptiveFormats ?? [];
    const parsed = formats.map(wanted => {
        const candidates = available.filter(f => f.itag === wanted.itag);
        const match = candidates.find(f => !wanted.audioTrackId || f.audioTrack?.id === wanted.audioTrackId)
            ?? candidates[0];

        return match && parseFormat(match);
    });

    if (!parsed.length || parsed.some(p => !p)) return;

    const n = [...new Set(parsed.map(p => p.url.searchParams.get("n")).filter(Boolean))];
    const sig = [...new Set(parsed.map(p => p.s).filter(Boolean))];

    // the player is only needed when there's something to solve
    const solved = n.length || sig.length
        ? await solve(await getPlayer(playerId, dispatcher), n, sig)
        : { n: {}, sig: {} };

    const urls = parsed.map(p => {
        const n = p.url.searchParams.get("n");
        if (n) {
            if (!solved.n[n]) throw new Error("n challenge wasn't solved");
            p.url.searchParams.set("n", solved.n[n]);
        }
        if (p.s) {
            if (!solved.sig[p.s]) throw new Error("sig challenge wasn't solved");
            p.url.searchParams.set(p.sp, solved.sig[p.s]);
        }
        return p.url.toString();
    });

    // the links only work once the pre-roll ad would be over
    const remaining = wait * 1000 + 500 - (Date.now() - requestedAt);
    if (wait && remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
    }

    return urls;
}
