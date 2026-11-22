// outgoing proxy support:
// - http(s) and socks (socks4, socks5) proxies via HTTP_PROXY/HTTPS_PROXY
// - per-service proxies via SERVICE_PROXIES, e.g. "youtube=socks5://host:1080"
//
// services make requests with the global dispatcher, so the service a request
// belongs to is tracked with AsyncLocalStorage (see withService) and the
// global dispatcher picks the matching proxy.

import { AsyncLocalStorage } from "node:async_hooks";
import { SocksClient } from "socks";
import { Agent, ProxyAgent, EnvHttpProxyAgent, Dispatcher, buildConnector } from "undici";

const SOCKS_PROTOCOLS = {
    "socks:": 5,
    "socks5:": 5,
    "socks5h:": 5,
    "socks4:": 4,
    "socks4a:": 4,
};

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export const DIRECT = "direct";

const serviceContext = new AsyncLocalStorage();

// tunnels of a service use its proxy too (e.g. "youtube-subtitles" -> "youtube")
const baseService = (service) => String(service ?? "").replace(/-(subtitles|cover)$/, "");

export const withService = (service, fn) =>
    serviceContext.run({ service: baseService(service) }, fn);

export const currentService = () => serviceContext.getStore()?.service;

export const isSocksURL = (url) => {
    try {
        return new URL(url).protocol in SOCKS_PROTOCOLS;
    } catch {
        return false;
    }
}

export const validateProxyURL = (input) => {
    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error(`invalid proxy url: ${input}`);
    }

    if (!(url.protocol in SOCKS_PROTOCOLS) && !HTTP_PROTOCOLS.has(url.protocol)) {
        throw new Error(`unsupported proxy protocol: ${url.protocol}`);
    }

    if (!url.hostname) {
        throw new Error(`proxy url has no host: ${input}`);
    }

    return url;
}

const socksConnector = (proxyUrl, tlsOptions = {}) => {
    const url = validateProxyURL(proxyUrl);
    const type = SOCKS_PROTOCOLS[url.protocol];

    const proxy = {
        host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: Number(url.port) || 1080,
        type,
        userId: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
    };

    // tls (for https destinations) runs on top of the socks tunnel
    const tlsConnect = buildConnector(tlsOptions);

    return async (options, callback) => {
        const https = options.protocol === "https:";
        const port = Number(options.port) || (https ? 443 : 80);

        let socket;
        try {
            // the proxy resolves the hostname, so dns doesn't leak locally
            ({ socket } = await SocksClient.createConnection({
                proxy,
                command: "connect",
                destination: {
                    host: options.hostname.replace(/^\[(.*)\]$/, "$1"),
                    port,
                },
                timeout: 15000,
            }));
        } catch (e) {
            return callback(e);
        }

        if (!https) {
            return callback(null, socket);
        }

        tlsConnect({ ...options, httpSocket: socket }, callback);
    }
}

// creates a dispatcher that sends requests through the given proxy
export const createProxyAgent = (proxyUrl, { tls } = {}) => {
    if (proxyUrl === DIRECT) {
        return new Agent();
    }

    const url = validateProxyURL(proxyUrl);

    if (url.protocol in SOCKS_PROTOCOLS) {
        return new Agent({ connect: socksConnector(url.toString(), tls) });
    }

    return new ProxyAgent({ uri: url.toString(), ...(tls ? { requestTls: tls } : {}) });
}

const matchesNoProxy = (url, noProxy) => {
    if (!noProxy) return false;

    const host = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
    const port = url.port || (url.protocol === "https:" ? "443" : "80");

    return noProxy.split(/[,\s]+/).filter(Boolean).some(entry => {
        entry = entry.toLowerCase();
        if (entry === "*") return true;

        const [ entryHost, entryPort ] = entry.split(/:(?=\d+$)/);
        if (entryPort && entryPort !== port) return false;

        const bare = entryHost.replace(/^\*?\./, "");
        return host === bare || host.endsWith(`.${bare}`);
    });
}

// like undici's EnvHttpProxyAgent, but also accepts socks proxies
class EnvProxyDispatcher extends Dispatcher {
    #http;
    #https;
    #direct = new Agent();
    #noProxy;

    constructor({ httpProxy, httpsProxy, noProxy }) {
        super();
        this.#http = httpProxy ? createProxyAgent(httpProxy) : this.#direct;
        this.#https = httpsProxy ? createProxyAgent(httpsProxy) : this.#http;
        this.#noProxy = noProxy;
    }

    #pick(origin) {
        const url = new URL(origin);
        if (matchesNoProxy(url, this.#noProxy)) return this.#direct;
        return url.protocol === "https:" ? this.#https : this.#http;
    }

    dispatch(options, handler) {
        return this.#pick(options.origin).dispatch(options, handler);
    }

    async close() {
        await Promise.all([this.#http, this.#https, this.#direct].map(d => d.close()));
    }

    async destroy(err) {
        await Promise.all([this.#http, this.#https, this.#direct].map(d => d.destroy(err)));
    }
}

// global dispatcher: the proxy of the current service if it has one,
// otherwise the general proxy settings
class ServiceProxyRouter extends Dispatcher {
    #fallback;
    #services;

    constructor(fallback, services) {
        super();
        this.#fallback = fallback;
        this.#services = services;
    }

    dispatch(options, handler) {
        const target = this.#services.get(currentService()) ?? this.#fallback;
        return target.dispatch(options, handler);
    }

    async close() {
        await Promise.all([this.#fallback, ...this.#services.values()].map(d => d.close()));
    }

    async destroy(err) {
        await Promise.all([this.#fallback, ...this.#services.values()].map(d => d.destroy(err)));
    }
}

// "youtube=socks5://host:1080, instagram=http://host:8080, tiktok=direct"
export const parseServiceProxies = (value, knownServices) => {
    const proxies = new Map();
    if (!value?.trim()) return proxies;

    for (const entry of value.split(/[,;\s]+/).filter(Boolean)) {
        const separator = entry.indexOf("=");
        if (separator < 1) {
            throw new Error(`invalid SERVICE_PROXIES entry: ${entry}`);
        }

        const service = entry.slice(0, separator).trim().toLowerCase();
        const proxy = entry.slice(separator + 1).trim();

        if (knownServices && !knownServices.has(service)) {
            throw new Error(`unknown service in SERVICE_PROXIES: ${service}`);
        }

        if (proxy !== DIRECT) {
            validateProxyURL(proxy);
        }

        proxies.set(service, proxy);
    }

    return proxies;
}

const proxyEnv = (key) => process.env[key] ?? process.env[key.toLowerCase()];

let config = { general: false, services: new Map() };

// whether requests of a service go through a proxy (in which case the
// proxy, not this server, resolves hostnames)
export const hasProxyFor = (service) => {
    const proxy = config.services.get(baseService(service));
    if (proxy !== undefined) return proxy !== DIRECT;
    return config.general;
}

export const buildGlobalDispatcher = ({ externalProxy, serviceProxies, knownServices }) => {
    const httpProxy = externalProxy || proxyEnv("HTTP_PROXY");
    const httpsProxy = externalProxy || proxyEnv("HTTPS_PROXY");
    const noProxy = proxyEnv("NO_PROXY");

    // undici's own agent is kept for http proxies, it's the long-tested path
    const fallback = [httpProxy, httpsProxy].some(isSocksURL)
        ? new EnvProxyDispatcher({ httpProxy, httpsProxy, noProxy })
        : new EnvHttpProxyAgent(externalProxy ? { httpProxy: externalProxy } : {});

    const services = parseServiceProxies(serviceProxies, knownServices);

    config = {
        general: !!(httpProxy || httpsProxy),
        services,
    };

    const serviceAgents = new Map(
        [...services].map(([ service, proxy ]) => [ service, createProxyAgent(proxy) ])
    );

    return new ServiceProxyRouter(fallback, serviceAgents);
}
