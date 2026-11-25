import * as cluster from "../../misc/cluster.js";

import { Agent } from "undici";
import { env } from "../../config.js";
import { Green, Yellow } from "../../misc/console-text.js";

const defaultAgent = new Agent();

let session;

const validateSession = (sessionResponse) => {
    sessionResponse.visitor_data ??= sessionResponse.contentBinding;
    sessionResponse.potoken ??= sessionResponse.poToken;
    sessionResponse.updated ??= new Date().getTime();

    if (!sessionResponse.potoken) {
        throw "no poToken in session response";
    }

    if (!sessionResponse.visitor_data) {
        throw "no visitor_data in session response";
    }

    if (!sessionResponse.updated) {
        throw "no last update timestamp in session response";
    }

    // https://github.com/iv-org/youtube-trusted-session-generator/blob/c2dfe3f/potoken_generator/main.py#L25
    if (sessionResponse.potoken.length < 160) {
        console.error(`${Yellow('[!]')} poToken is too short and might not work (${new Date().toISOString()})`);
    }
}

const updateSession = (newSession) => {
    session = newSession;
}

// the session server is bgutil's po token provider
// (https://github.com/Brainicism/bgutil-ytdlp-pot-provider). it only accepts
// json requests (415 otherwise). without a content binding in the request,
// it makes new visitor data and returns it as the content binding.
export const loadSession = async () => {
    const sessionServerUrl = new URL(env.ytSessionServer);
    sessionServerUrl.pathname = "/get_pot";

    const response = await fetch(sessionServerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        dispatcher: defaultAgent,
        signal: AbortSignal.timeout(60000),
    });

    const newSession = await response.json();
    if (!response.ok) {
        throw `session server answered ${response.status}: ${newSession?.error ?? "unknown error"}`;
    }

    validateSession(newSession);

    if (!session || session.updated < newSession?.updated) {
        cluster.broadcast({ youtube_session: newSession });
        updateSession(newSession);
    }
}

const wrapLoad = (initial = false) => {
    loadSession()
    .then(() => {
        if (initial) {
            console.log(`${Green('[✓]')} poToken & visitor_data loaded successfully!`);
        }
    })
    .catch((e) => {
        console.error(`${Yellow('[!]')} Failed loading poToken & visitor_data at ${new Date().toISOString()}.`);
        console.error('Error:', e);
    })
}

export const getYouTubeSession = () => {
    return session;
}

export const setup = () => {
    if (cluster.isPrimary) {
        wrapLoad(true);
        if (env.ytSessionReloadInterval > 0) {
            setInterval(wrapLoad, env.ytSessionReloadInterval * 1000);
        }
    } else if (cluster.isWorker) {
        process.on('message', (message) => {
            if ('youtube_session' in message) {
                updateSession(message.youtube_session);
            }
        });
    }
}
