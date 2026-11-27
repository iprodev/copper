// protects the generic extractor (and its tunnels) from server-side request
// forgery: user-provided urls must never make the server reach its own
// loopback interface, private networks, link-local addresses (such as cloud
// metadata endpoints) or any other non-public address.

import dns from "node:dns";
import ip from "ipaddr.js";
import { Agent } from "undici";
import { hasProxyFor } from "../misc/proxy.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export const MAX_REDIRECTS = 5;

export class UnsafeURLError extends Error {
    constructor(reason) {
        super(`unsafe url: ${reason}`);
        this.name = "UnsafeURLError";
    }
}

export const isPublicAddress = (address) => {
    try {
        return ip.process(String(address)).range() === "unicast";
    } catch {
        return false;
    }
}

const stripBrackets = (hostname) => hostname.replace(/^\[(.*)\]$/, "$1");

const lookupAll = (hostname) => new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
        if (err) return reject(err);
        resolve(addresses.map(a => a.address));
    });
});

// throws an UnsafeURLError if the url may point anywhere but the public internet
export const assertSafeURL = async (input, { resolve = lookupAll } = {}) => {
    let url;
    try {
        url = new URL(input);
    } catch {
        throw new UnsafeURLError("invalid url");
    }

    if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
        throw new UnsafeURLError(`protocol ${url.protocol} is not allowed`);
    }

    if (!ALLOWED_PORTS.has(url.port)) {
        throw new UnsafeURLError(`port ${url.port} is not allowed`);
    }

    if (url.username || url.password) {
        throw new UnsafeURLError("credentials are not allowed");
    }

    const hostname = stripBrackets(url.hostname);
    if (!hostname) {
        throw new UnsafeURLError("missing hostname");
    }

    if (ip.isValid(hostname)) {
        if (!isPublicAddress(hostname)) {
            throw new UnsafeURLError("address is not public");
        }
        return url;
    }

    let addresses;
    try {
        addresses = await resolve(hostname);
    } catch {
        throw new UnsafeURLError("hostname doesn't resolve");
    }

    // every address must be public, otherwise the connection may land on any of them
    if (!addresses.length || !addresses.every(isPublicAddress)) {
        throw new UnsafeURLError("hostname resolves to a non-public address");
    }

    return url;
}

// when the server talks to the internet directly, addresses are also checked
// at connection time. this covers dns rebinding between the check above and
// the actual request. behind an http proxy, the proxy resolves hostnames,
// so only the checks above apply. untrusted files of a service's link (from
// yt-dlp, "generic-<service>") go the way the service's requests go.
const usesProxy = (service = "generic") => hasProxyFor(service);

const guardedLookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
        if (err) return callback(err);

        const safe = addresses.filter(a => isPublicAddress(a.address));
        if (!safe.length || safe.length !== addresses.length) {
            return callback(new UnsafeURLError("hostname resolves to a non-public address"));
        }

        if (options?.all) return callback(null, safe);
        callback(null, safe[0].address, safe[0].family);
    });
}

let guardedAgent;
export const getSafeDispatcher = (service = "generic") => {
    // the global dispatcher picks the service's proxy
    if (usesProxy(service)) return;

    guardedAgent ??= new Agent({
        connect: { lookup: guardedLookup },
    });

    return guardedAgent;
}

// fetch that checks every url, including each redirect target
export const safeFetch = async (input, options = {}) => {
    let url = input;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        await assertSafeURL(url);

        const response = await fetch(url, {
            ...options,
            redirect: "manual",
            dispatcher: getSafeDispatcher(),
        });

        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
            await response.body?.cancel().catch(() => {});
            url = new URL(location, url).toString();
            continue;
        }

        return { response, url: String(url) };
    }

    throw new UnsafeURLError("too many redirects");
}

// reads a response body as text, but stops at `limit` bytes
export const readLimitedText = async (response, limit) => {
    const reader = response.body?.getReader();
    if (!reader) return "";

    const chunks = [];
    let size = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        size += value.length;
        if (size > limit) {
            await reader.cancel().catch(() => {});
            throw new Error("response is too big");
        }

        chunks.push(value);
    }

    return Buffer.concat(chunks).toString("utf8");
}
