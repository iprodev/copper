// shared environment for unit tests. loaded via `node --import`,
// so it runs before any module reads process.env.

import { Agent, setGlobalDispatcher } from "undici";

// like the api does on startup (core/api.js). without it, node 24's own
// fetch sets a global dispatcher from its newer built-in undici, which the
// undici package's request() then uses, and it refuses `maxRedirections`.
setGlobalDispatcher(new Agent());

process.env.API_URL = "http://localhost:9000/";
process.env.TURNSTILE_SITEKEY = "1x00000000000000000000AA";
process.env.TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";
process.env.JWT_SECRET = "unit-test-secret-0123456789abcdef";
process.env.JWT_EXPIRY = "120";

for (const key of ["API_REDIS_URL", "API_KEY_URL", "API_ENV_FILE", "COOKIE_PATH", "FREEBIND_CIDR"]) {
    delete process.env[key];
}
