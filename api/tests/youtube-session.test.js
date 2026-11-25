import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { env } from "../src/config.js";
import { loadSession, getYouTubeSession } from "../src/processing/helpers/youtube-session.js";

// behaves like bgutil's po token provider: POST /get_pot, json only
const requests = [];
const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
        requests.push({ method: req.method, url: req.url, type: req.headers["content-type"], body });

        if (req.method !== "POST" || req.url !== "/get_pot") {
            res.statusCode = 404;
            return res.end();
        }

        res.setHeader("content-type", "application/json");

        if (req.headers["content-type"] !== "application/json") {
            res.statusCode = 415;
            return res.end(JSON.stringify({ error: "Unsupported Media Type" }));
        }

        res.end(JSON.stringify({
            poToken: "p".repeat(180),
            contentBinding: "visitor-data",
            expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        }));
    });
});

test("the po token and visitor data come from bgutil's provider", async (t) => {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => server.close());

    const previous = env.ytSessionServer;
    env.ytSessionServer = `http://127.0.0.1:${server.address().port}/`;
    t.after(() => env.ytSessionServer = previous);

    await loadSession();

    assert.deepEqual(requests.at(-1), {
        method: "POST", url: "/get_pot", type: "application/json", body: "{}",
    });

    const session = getYouTubeSession();
    assert.equal(session.potoken, "p".repeat(180));
    assert.equal(session.visitor_data, "visitor-data");
    assert.ok(session.updated > 0);
});

test("errors of the provider aren't taken as a session", async (t) => {
    const failing = http.createServer((_, res) => {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "couldn't reach youtube" }));
    });
    await new Promise(resolve => failing.listen(0, "127.0.0.1", resolve));
    t.after(() => failing.close());

    const previous = env.ytSessionServer;
    env.ytSessionServer = `http://127.0.0.1:${failing.address().port}/`;
    t.after(() => env.ytSessionServer = previous);

    await assert.rejects(loadSession(), /500: couldn't reach youtube/);
});
