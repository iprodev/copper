import { Agent, request } from "undici";
import { create as contentDisposition } from "content-disposition-header";

import { env } from "../config.js";
import { destroyInternalStream } from "./manage.js";
import { getHeaders, closeRequest, closeResponse, pipe } from "./shared.js";

const defaultAgent = new Agent();

// the internal stream is kept until the tunnel expires, so an interrupted
// download can continue where it stopped (with a range request)
const destroyLater = (url) => {
    setTimeout(() => destroyInternalStream(url), env.streamLifespan * 1000).unref();
}

export default async function (streamInfo, res) {
    const abortController = new AbortController();
    let done = false;
    const shutdown = () => {
        if (done) return;
        done = true;
        closeRequest(abortController);
        closeResponse(res);
        destroyLater(streamInfo.urls);
    };

    try {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-disposition', contentDisposition(streamInfo.filename));

        const { body: stream, headers, statusCode } = await request(streamInfo.urls, {
            headers: {
                ...getHeaders(streamInfo.service),
                Range: streamInfo.range
            },
            signal: abortController.signal,
            maxRedirections: 16,
            dispatcher: defaultAgent,
        });

        res.status(statusCode);

        for (const headerName of ['accept-ranges', 'content-type', 'content-length', 'content-range']) {
            if (headers[headerName]) {
                res.setHeader(headerName, headers[headerName]);
            }
        }

        pipe(stream, res, shutdown);
    } catch {
        shutdown();
    }
}
