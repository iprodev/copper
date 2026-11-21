import { test } from "node:test";
import assert from "node:assert/strict";

import jwt from "../src/security/jwt.js";

const IP = "203.0.113.7";

const decode = (token) =>
    JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());

test("generated token verifies for the same ip", () => {
    const { token, exp } = jwt.generate(IP);

    assert.equal(exp, 118);
    assert.ok(jwt.verify(token, IP));
});

test("token expiry is a number within the configured lifetime", () => {
    const { token } = jwt.generate(IP);
    const { exp } = decode(token);
    const now = Math.floor(Date.now() / 1000);

    assert.equal(typeof exp, "number");
    assert.ok(exp > now && exp <= now + 120);
});

test("token is rejected for a different ip", () => {
    const { token } = jwt.generate(IP);
    assert.equal(jwt.verify(token, "203.0.113.8"), false);
});

test("tampered or truncated tokens are rejected", () => {
    const { token } = jwt.generate(IP);
    const [header, payload, signature] = token.split(".");

    const flipped = signature.at(-1) === "A" ? "B" : "A";
    assert.equal(jwt.verify(`${header}.${payload}.${signature.slice(0, -1)}${flipped}`, IP), false);
    assert.equal(jwt.verify(`${header}.${payload}.${signature.slice(0, -3)}`, IP), false);
    assert.equal(jwt.verify(`${header}.${payload}`, IP), false);
    assert.equal(jwt.verify(`${token}.extra`, IP), false);

    const forged = Buffer.from(JSON.stringify({ ...decode(token), exp: 9e12 })).toString("base64url");
    assert.equal(jwt.verify(`${header}.${forged}.${signature}`, IP), false);
});

test("expired token is rejected", (t) => {
    const { token } = jwt.generate(IP);

    t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 121 * 1000 });
    assert.equal(jwt.verify(token, IP), false);
});
