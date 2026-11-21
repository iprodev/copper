import { test } from "node:test";
import assert from "node:assert/strict";

import { createStream, verifyStream } from "../src/stream/manage.js";
import { encryptStream, decryptStream } from "../src/misc/crypto.js";

const params = (link) => Object.fromEntries(new URL(link).searchParams);

const verify = ({ id, sig, exp, sec, iv }) => verifyStream(id, sig, exp, sec, iv);

const makeStream = async () => {
    const link = createStream({
        type: "proxy",
        url: "https://cdn.example/a.mp4",
        service: "tumblr",
        filename: "a.mp4",
    });

    // the store write isn't awaited in createStream
    await new Promise(r => setImmediate(r));
    return params(link);
};

test("encryption round trip", () => {
    const iv = "AAAAAAAAAAAAAAAAAAAAAA";
    const secret = Buffer.alloc(32, 7).toString("base64url");
    const data = { hello: "world", n: 1 };

    const encrypted = encryptStream(data, iv, secret);
    assert.notEqual(encrypted.toString(), JSON.stringify(data));
    assert.deepEqual(JSON.parse(decryptStream(encrypted, iv, secret)), data);
});

test("valid tunnel link resolves to its stream info", async () => {
    const q = await makeStream();

    assert.equal(q.id.length, 21);
    assert.equal(q.sig.length, 43);
    assert.equal(q.sec.length, 43);
    assert.equal(q.iv.length, 22);

    const info = await verify(q);
    assert.equal(info.service, "tumblr");
    assert.equal(info.filename, "a.mp4");
    assert.match(info.urls, /^http:\/\/127\.0\.0\.1:\d+\/itunnel\?id=/);
});

test("tampered tunnel links are rejected", async () => {
    const q = await makeStream();

    assert.equal((await verify({ ...q, sig: "A".repeat(43) })).status, 401);
    assert.equal((await verify({ ...q, exp: String(Number(q.exp) + 1) })).status, 401);
    assert.equal((await verify({ ...q, id: "x".repeat(21) })).status, 401);
    assert.equal((await verify({ ...q, sec: "B".repeat(43) })).status, 401);
});

test("expired tunnel links are rejected", async (t) => {
    const q = await makeStream();

    t.mock.timers.enable({ apis: ["Date"], now: Number(q.exp) + 1 });
    assert.equal((await verify(q)).status, 404);
});
