import stream from "../stream/stream.js";
import { getInternalTunnel } from "../stream/manage.js";
import { setTunnelPort } from "../config.js";
import { Green } from "../misc/console-text.js";
import express from "express";
import { withService } from "../misc/proxy.js";
import { getHeaders } from "../stream/shared.js";

// headers of the tunnel's consumer (ffmpeg) that aren't sent to the
// service: some (like tiktok) refuse requests from ffmpeg's user agent
const ignoredRequestHeaders = new Set(["user-agent", "host", "connection"]);

const validateTunnel = (req, res) => {
    if (!req.ip.endsWith('127.0.0.1')) {
        res.sendStatus(403);
        return;
    }

    if (String(req.query.id).length !== 21) {
        res.sendStatus(400);
        return;
    }

    const streamInfo = getInternalTunnel(req.query.id);
    if (!streamInfo) {
        res.sendStatus(404);
        return;
    }

    return streamInfo;
}

const streamTunnel = (req, res) => {
    const streamInfo = validateTunnel(req, res);
    if (!streamInfo) {
        return;
    }

    // headers of a request (like range) are only used for that request:
    // the tunnel can be requested again (e.g. to continue a download), so
    // they're added to the tunnel's own headers every time, not kept.
    // the service's usual headers go first, the tunnel's own ones last.
    streamInfo.baseHeaders ??= new Map(streamInfo.headers || []);
    streamInfo.headers = new Map([
        ...Object.entries(getHeaders(streamInfo.service)),
        ...Object.entries(req.headers)
            .filter(([ name ]) => !ignoredRequestHeaders.has(name.toLowerCase())),
        ...streamInfo.baseHeaders,
    ]);

    return withService(streamInfo.service, () =>
        stream(res, { type: 'internal', data: streamInfo })
    );
}

export const setupTunnelHandler = () => {
    const tunnelHandler = express();

    tunnelHandler.get('/itunnel', streamTunnel);

    // fallback
    tunnelHandler.use((_, res) => res.sendStatus(400));
    // error handler
    tunnelHandler.use((_, __, res, ____) => res.socket.end());


    const server = tunnelHandler.listen({
        port: 0,
        host: '127.0.0.1',
        exclusive: true
    }, () => {
        const { port } = server.address();
        console.log(`${Green('[✓]')} internal tunnel handler running on 127.0.0.1:${port}`);
        setTunnelPort(port);
    });

    return server;
}
