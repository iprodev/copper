import { test, before } from "node:test";
import assert from "node:assert/strict";

import { env } from "../src/config.js";
import * as APIKeys from "../src/security/api-keys.js";

const OPEN_KEY = "00000000-0000-4000-8000-000000000001";
const IP_KEY = "00000000-0000-4000-8000-000000000002";
const UA_KEY = "00000000-0000-4000-8000-000000000003";

const keys = {
    [OPEN_KEY]: { name: "open", limit: "unlimited", allowedServices: ["youtube"] },
    [IP_KEY]: { ips: ["192.0.2.0/24", "2001:db8::/32"], limit: 5 },
    [UA_KEY]: { userAgents: ["curl/*"] },
};

const request = (authorization, ip = "198.51.100.1", userAgent) => ({
    ip,
    get: (header) => ({
        "Authorization": authorization,
        "User-Agent": userAgent,
    })[header],
});

before(async () => {
    env.keyReloadInterval = 0;
    const url = new URL(`data:application/json,${encodeURIComponent(JSON.stringify(keys))}`);
    APIKeys.setup(url);

    for (let i = 0; i < 100; i++) {
        if (APIKeys.validateAuthorization(request(`Api-Key ${OPEN_KEY}`)).success) return;
        await new Promise(r => setTimeout(r, 10));
    }
    throw new Error("api keys were not loaded");
});

test("missing and malformed authorization", () => {
    assert.equal(APIKeys.validateAuthorization(request(undefined)).error, "missing");
    assert.equal(APIKeys.validateAuthorization(request("Bearer abc")).error, "not_api_key");
    assert.equal(APIKeys.validateAuthorization(request("Api-Key nope")).error, "invalid");
    assert.equal(APIKeys.validateAuthorization(request(`Api-Key  ${OPEN_KEY}`)).error, "invalid");
    assert.equal(
        APIKeys.validateAuthorization(request("Api-Key 00000000-0000-4000-8000-00000000ffff")).error,
        "not_found"
    );
});

test("valid key sets rate limit info on the request", () => {
    const req = request(`Api-Key ${OPEN_KEY.toUpperCase()}`);
    assert.ok(APIKeys.validateAuthorization(req).success);
    assert.equal(req.rateLimitKey, OPEN_KEY);
    assert.equal(req.rateLimitMax, Infinity);
});

test("ip restrictions accept plain, ipv4-mapped and ipv6 addresses", () => {
    for (const ip of ["192.0.2.10", "::ffff:192.0.2.10", "2001:db8::1"]) {
        assert.ok(APIKeys.validateAuthorization(request(`Api-Key ${IP_KEY}`, ip)).success, ip);
    }

    for (const ip of ["198.51.100.1", "::ffff:198.51.100.1", "2001:db9::1"]) {
        assert.equal(
            APIKeys.validateAuthorization(request(`Api-Key ${IP_KEY}`, ip)).error,
            "ip_not_allowed",
            ip
        );
    }
});

test("user agent restrictions", () => {
    const auth = `Api-Key ${UA_KEY}`;
    assert.ok(APIKeys.validateAuthorization(request(auth, undefined, "curl/8.0")).success);
    assert.equal(APIKeys.validateAuthorization(request(auth, undefined, "wget/1.0")).error, "ua_not_allowed");
    assert.equal(APIKeys.validateAuthorization(request(auth, undefined, undefined)).error, "ua_not_allowed");
});

test("allowed services per key", () => {
    assert.deepEqual([...APIKeys.getAllowedServices(OPEN_KEY)], ["youtube"]);
    assert.equal(APIKeys.getAllowedServices(UA_KEY), undefined);
    assert.equal(APIKeys.getAllowedServices(undefined), undefined);
});
