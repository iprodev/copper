import { test } from "node:test";
import assert from "node:assert/strict";

// config.js must be loaded before env.js, same as in src/fetchr.js
import "../src/config.js";
import { loadEnvs, parseEnvFile } from "../src/core/env.js";

test("numeric envs are parsed as numbers", () => {
    const env = loadEnvs({
        API_URL: "http://localhost:9000/",
        JWT_EXPIRY: "300",
        RATELIMIT_MAX: "50",
        DURATION_LIMIT: "60",
    });

    assert.equal(env.jwtLifetime, 300);
    assert.equal(env.rateLimitMax, 50);
    assert.equal(env.durationLimit, 60);
});

test("numeric envs fall back to defaults", () => {
    const env = loadEnvs({ API_URL: "http://localhost:9000/", JWT_EXPIRY: "abc" });

    assert.equal(env.jwtLifetime, 120);
    assert.equal(env.rateLimitMax, 20);
    assert.equal(env.rateLimitWindow, 60);
    assert.equal(env.streamLifespan, 90);
});

test("DISABLED_SERVICES removes services", () => {
    const env = loadEnvs({ DISABLED_SERVICES: "youtube,tiktok" });

    assert.ok(!env.enabledServices.has("youtube"));
    assert.ok(!env.enabledServices.has("tiktok"));
    assert.ok(env.enabledServices.has("twitter"));
    assert.ok(env.allServices.has("youtube"));
});

test("sessions are enabled only when all three secrets are set", () => {
    const full = { TURNSTILE_SITEKEY: "a", TURNSTILE_SECRET: "b", JWT_SECRET: "c" };
    assert.ok(loadEnvs(full).sessionEnabled);
    assert.ok(!loadEnvs({ ...full, JWT_SECRET: undefined }).sessionEnabled);
});

test("env file parser handles comments, empty values and quotes", () => {
    const parsed = parseEnvFile([
        "# a comment",
        "",
        "   # indented comment",
        "RATELIMIT_MAX=50",
        "EMPTY=",
        'DOUBLE="hello world"',
        "SINGLE='single quoted'",
        "WITH_EQUALS=a=b=c",
        "  SPACED  =  value  ",
    ].join("\n"));

    assert.deepEqual(parsed, {
        RATELIMIT_MAX: "50",
        EMPTY: "",
        DOUBLE: "hello world",
        SINGLE: "single quoted",
        WITH_EQUALS: "a=b=c",
        SPACED: "value",
    });
});
