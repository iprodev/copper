import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { fetch } from "undici";

import {
    DIRECT,
    withService,
    currentService,
    isSocksURL,
    validateProxyURL,
    createProxyAgent,
    parseServiceProxies,
    buildGlobalDispatcher,
    hasProxyFor,
} from "../src/misc/proxy.js";
import { getSafeDispatcher } from "../src/security/network.js";

// the tests decide which proxies are used, not the machine they run on
for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) {
    delete process.env[key];
}

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const cert = fixture("localhost-cert.pem");
const key = fixture("localhost-key.pem");

const listen = (server) => new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});

// minimal socks5 server (rfc 1928, rfc 1929), remembers every destination
const createSocksServer = ({ username, password } = {}) => {
    const destinations = [];

    const server = net.createServer(async (client) => {
        let buffer = Buffer.alloc(0);
        let waiting;

        const onData = (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            waiting?.();
        };
        client.on("data", onData);
        client.on("error", () => {});

        const read = async (length) => {
            while (buffer.length < length) {
                await new Promise((resolve, reject) => {
                    waiting = resolve;
                    client.once("close", reject);
                });
            }
            const out = buffer.subarray(0, length);
            buffer = buffer.subarray(length);
            return out;
        };

        try {
            const [ version, count ] = await read(2);
            const methods = [...await read(count)];
            if (version !== 5) return client.destroy();

            const method = username ? 2 : 0;
            if (!methods.includes(method)) {
                return client.end(Buffer.from([5, 0xff]));
            }
            client.write(Buffer.from([5, method]));

            if (method === 2) {
                await read(1);
                const user = (await read((await read(1))[0])).toString();
                const pass = (await read((await read(1))[0])).toString();

                if (user !== username || pass !== password) {
                    return client.end(Buffer.from([1, 1]));
                }
                client.write(Buffer.from([1, 0]));
            }

            const [ , command, , type ] = await read(4);
            let host;
            if (type === 1) host = [...await read(4)].join(".");
            else if (type === 3) host = (await read((await read(1))[0])).toString();
            else if (type === 4) host = (await read(16)).toString("hex").match(/.{4}/g).join(":");
            const port = (await read(2)).readUInt16BE();

            if (command !== 1) return client.destroy();
            destinations.push(`${host}:${port}`);

            const upstream = net.connect(port, host, () => {
                client.off("data", onData);
                client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
                if (buffer.length) upstream.write(buffer);
                client.pipe(upstream).pipe(client);
            });
            upstream.on("error", () => client.destroy());
        } catch {
            client.destroy();
        }
    });

    return { server, destinations };
}

const socks = createSocksServer();
const authSocks = createSocksServer({ username: "fetchr user", password: "p@ss:word" });

const target = http.createServer((req, res) => res.end(`hello from ${req.url}`));
const secureTarget = https.createServer({ cert, key }, (req, res) => res.end(`secure ${req.url}`));

let socksURL, authSocksPort, targetPort, securePort;

before(async () => {
    socksURL = `socks5://127.0.0.1:${await listen(socks.server)}`;
    authSocksPort = await listen(authSocks.server);
    targetPort = await listen(target);
    securePort = await listen(secureTarget);
});

after(() => {
    for (const server of [socks.server, authSocks.server, target, secureTarget]) {
        server.closeAllConnections?.();
        server.close();
    }
});

const get = async (url, dispatcher) => {
    const response = await fetch(url, { dispatcher });
    return response.text();
}

test("proxy urls are validated", () => {
    for (const url of [
        "http://proxy:8080", "https://proxy", "socks://proxy", "socks5://u:p@proxy:1080",
        "socks5h://proxy", "socks4://proxy:1080", "socks4a://proxy", "socks5://[::1]:1080",
    ]) {
        assert.ok(validateProxyURL(url), url);
    }

    for (const url of ["ftp://proxy", "proxy:8080", "", "not a url", "file:///etc/passwd"]) {
        assert.throws(() => validateProxyURL(url), url);
    }

    assert.ok(isSocksURL("socks5://proxy"));
    assert.ok(isSocksURL("socks4a://proxy"));
    assert.equal(isSocksURL("http://proxy"), false);
    assert.equal(isSocksURL(undefined), false);
});

test("http requests go through a socks5 proxy", async () => {
    const agent = createProxyAgent(socksURL);
    try {
        assert.equal(await get(`http://localhost:${targetPort}/plain`, agent), "hello from /plain");
        // the hostname is resolved by the proxy, not locally
        assert.ok(socks.destinations.includes(`localhost:${targetPort}`));
    } finally {
        await agent.close();
    }
});

test("https requests go through a socks5 proxy, with tls end to end", async () => {
    const agent = createProxyAgent(socksURL, { tls: { ca: cert } });
    try {
        assert.equal(await get(`https://localhost:${securePort}/tls`, agent), "secure /tls");
    } finally {
        await agent.close();
    }

    // the certificate is still verified through the tunnel
    const untrusting = createProxyAgent(socksURL);
    try {
        await assert.rejects(get(`https://localhost:${securePort}/tls`, untrusting));
    } finally {
        await untrusting.close();
    }
});

test("socks5 proxies with a username and password", async () => {
    const credentials = `${encodeURIComponent("fetchr user")}:${encodeURIComponent("p@ss:word")}`;

    const agent = createProxyAgent(`socks5://${credentials}@127.0.0.1:${authSocksPort}`);
    try {
        assert.equal(await get(`http://127.0.0.1:${targetPort}/auth`, agent), "hello from /auth");
        assert.deepEqual(authSocks.destinations, [`127.0.0.1:${targetPort}`]);
    } finally {
        await agent.close();
    }

    for (const url of [
        `socks5://fetchr:wrong@127.0.0.1:${authSocksPort}`,
        `socks5://127.0.0.1:${authSocksPort}`,
    ]) {
        const rejected = createProxyAgent(url);
        try {
            await assert.rejects(get(`http://127.0.0.1:${targetPort}/auth`, rejected), url);
        } finally {
            await rejected.close();
        }
    }

    assert.equal(authSocks.destinations.length, 1);
});

test("SERVICE_PROXIES is parsed and validated", () => {
    const known = new Set(["youtube", "instagram", "tiktok", "generic"]);

    const parsed = parseServiceProxies(
        " youtube=socks5://u:p@host:1080, Instagram=http://host:8080;\ntiktok=direct ",
        known,
    );
    assert.deepEqual([...parsed], [
        ["youtube", "socks5://u:p@host:1080"],
        ["instagram", "http://host:8080"],
        ["tiktok", DIRECT],
    ]);

    assert.equal(parseServiceProxies("", known).size, 0);
    assert.equal(parseServiceProxies(undefined, known).size, 0);

    for (const value of [
        "youtube",
        "=socks5://host",
        "myspace=socks5://host",
        "youtube=ftp://host",
        "youtube=not-a-url",
    ]) {
        assert.throws(() => parseServiceProxies(value, known), value);
    }
});

test("the current service is tracked across async code", async () => {
    assert.equal(currentService(), undefined);

    await withService("youtube", async () => {
        await new Promise(r => setTimeout(r, 1));
        assert.equal(currentService(), "youtube");

        await withService("vimeo", async () => {
            assert.equal(currentService(), "vimeo");
        });

        assert.equal(currentService(), "youtube");
    });

    // tunnels of a service belong to the service itself
    withService("youtube-subtitles", () => assert.equal(currentService(), "youtube"));
    withService("tiktok-cover", () => assert.equal(currentService(), "tiktok"));
});

test("each service uses its own proxy", async () => {
    const dispatcher = buildGlobalDispatcher({
        serviceProxies: `youtube=${socksURL}, vimeo=direct`,
        knownServices: new Set(["youtube", "vimeo", "tiktok"]),
    });

    const seen = () => socks.destinations.filter(d => d.startsWith("127.0.0.1:")).length;
    const url = `http://127.0.0.1:${targetPort}/`;

    try {
        const before = seen();

        assert.equal(await withService("youtube", () => get(url + "yt", dispatcher)), "hello from /yt");
        assert.equal(await withService("youtube-subtitles", () => get(url + "sub", dispatcher)), "hello from /sub");
        assert.equal(seen(), before + 2);

        // files yt-dlp found for a youtube link go the same way (to another
        // address than above, so it's a new connection through the proxy)
        const proxied = socks.destinations.length;
        assert.equal(
            await withService("generic-youtube", () => get(`http://localhost:${targetPort}/ytdlp`, dispatcher)),
            "hello from /ytdlp"
        );
        assert.equal(socks.destinations.length, proxied + 1);

        // no proxy of its own and no general proxy: direct
        assert.equal(await withService("tiktok", () => get(url + "tt", dispatcher)), "hello from /tt");
        assert.equal(await withService("vimeo", () => get(url + "vm", dispatcher)), "hello from /vm");
        assert.equal(await get(url + "none", dispatcher), "hello from /none");
        assert.equal(socks.destinations.length, proxied + 1);

        assert.equal(hasProxyFor("youtube"), true);
        assert.equal(hasProxyFor("youtube-subtitles"), true);
        assert.equal(hasProxyFor("generic-youtube"), true);
        assert.equal(hasProxyFor("generic-tiktok"), false);
        assert.equal(hasProxyFor("generic"), false);

        // untrusted files are checked at connection time, unless they go
        // through a proxy (which then resolves hostnames)
        assert.equal(getSafeDispatcher("generic-youtube"), undefined);
        assert.ok(getSafeDispatcher("generic-tiktok"));
        assert.ok(getSafeDispatcher());
        assert.equal(hasProxyFor("vimeo"), false);
        assert.equal(hasProxyFor("tiktok"), false);
    } finally {
        await dispatcher.close();
    }
});

test("a general socks proxy, with per-service exceptions and NO_PROXY", async () => {
    const seen = () => socks.destinations.filter(d => d.startsWith("localhost:")).length;
    const url = `http://localhost:${targetPort}/`;

    const dispatcher = buildGlobalDispatcher({
        externalProxy: socksURL,
        serviceProxies: "vimeo=direct",
        knownServices: new Set(["youtube", "vimeo"]),
    });

    try {
        const before = seen();

        assert.equal(await withService("youtube", () => get(url + "a", dispatcher)), "hello from /a");
        assert.equal(await get(url + "b", dispatcher), "hello from /b");
        assert.equal(seen(), before + 2);

        assert.equal(await withService("vimeo", () => get(url + "c", dispatcher)), "hello from /c");
        assert.equal(seen(), before + 2);

        assert.equal(hasProxyFor("youtube"), true);
        assert.equal(hasProxyFor("generic"), true);
        assert.equal(hasProxyFor("vimeo"), false);
    } finally {
        await dispatcher.close();
    }

    process.env.HTTP_PROXY = socksURL;
    process.env.NO_PROXY = "example.com, localhost";
    const withNoProxy = buildGlobalDispatcher({});

    try {
        const before = seen();
        assert.equal(await get(url + "d", withNoProxy), "hello from /d");
        assert.equal(seen(), before);
    } finally {
        delete process.env.HTTP_PROXY;
        delete process.env.NO_PROXY;
        await withNoProxy.close();
    }

    // without any proxy settings
    const plain = buildGlobalDispatcher({});
    try {
        assert.equal(hasProxyFor("youtube"), false);
        assert.equal(hasProxyFor("generic"), false);
    } finally {
        await plain.close();
    }
});
