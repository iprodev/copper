import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { Limiter } from "../src/limiter.js";
import { Telegram, TelegramError } from "../src/telegram.js";

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

test("requests to one chat are spaced out and keep their order", async () => {
    const limiter = new Limiter({ perSecond: 1000, privateInterval: 100, groupInterval: 300 });
    const times = { private: [], group: [] };
    const order = [];

    await Promise.all([
        ...[1, 2, 3].map(i => limiter.schedule("5", async () => {
            times.private.push(Date.now());
            order.push(i);
            // a slow request (an upload): the next one waits for it
            if (i === 1) await sleep(150);
        })),
        ...[1, 2].map(() => limiter.schedule("-100", () => times.group.push(Date.now()))),
    ]);

    assert.deepEqual(order, [1, 2, 3]);
    const gaps = (list) => list.slice(1).map((time, i) => time - list[i]);
    // the first waits for the slow request to finish (150 ms), the second for the interval
    assert.ok(gaps(times.private)[0] >= 145, `${gaps(times.private)}`);
    assert.ok(gaps(times.private)[1] >= 95, `${gaps(times.private)}`);
    assert.ok(gaps(times.group)[0] >= 295, `${gaps(times.group)}`);
});

test("the total rate is limited, different chats don't wait for each other", async () => {
    const limiter = new Limiter({ perSecond: 20, privateInterval: 1000 });
    const start = Date.now();
    const times = [];

    // 40 chats, one request each: the first 20 right away, the rest at 20 per second
    await Promise.all(Array.from({ length: 40 }, (_, i) =>
        limiter.schedule(String(i), () => times.push(Date.now() - start))
    ));

    times.sort((a, b) => a - b);
    assert.ok(times[19] < 200, `${times[19]}`);
    assert.ok(times[39] >= 900, `${times[39]}`);
    assert.ok(times[39] < 1600, `${times[39]}`);
});

test("users' messages go before broadcasts", async () => {
    const limiter = new Limiter({ perSecond: 5, privateInterval: 0 });
    const order = [];

    const broadcast = Array.from({ length: 10 }, (_, i) =>
        limiter.schedule(`b${i}`, () => order.push(`broadcast ${i}`), { priority: "low" })
    );
    // a user writes while the broadcast is being sent
    await sleep(250);
    const user = limiter.schedule("user", () => order.push("user"));

    await Promise.all([...broadcast, user]);
    const position = order.indexOf("user");
    assert.ok(position > 0 && position < 9, `user message was #${position}`);
});

test("waiting edits of the same message are merged, only the latest is sent", async () => {
    const limiter = new Limiter({ perSecond: 1000, privateInterval: 100 });
    const sent = [];

    const first = limiter.schedule("7", () => sent.push("first message"));
    const edits = ["1/10", "2/10", "3/10", "4/10"].map(text =>
        limiter.schedule("7", () => sent.push(text), { key: "edit:7:1" })
    );
    const last = limiter.schedule("7", () => sent.push("done"));

    await Promise.all([first, ...edits, last]);
    assert.deepEqual(sent, ["first message", "4/10", "done"]);
});

test("after \"too many requests\", the chat waits as long as telegram asks", async () => {
    let calls = 0;
    const times = [];
    const server = http.createServer((req, res) => {
        calls++;
        times.push(Date.now());
        res.setHeader("content-type", "application/json");
        if (calls === 1) {
            return res.end(JSON.stringify({
                ok: false, error_code: 429,
                description: "Too Many Requests: retry after 1",
                parameters: { retry_after: 1 },
            }));
        }
        res.end(JSON.stringify({ ok: true, result: { message_id: calls } }));
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));

    try {
        const telegram = new Telegram({
            token: "1:x",
            apiUrl: `http://127.0.0.1:${server.address().port}`,
            limits: { privateInterval: 0, retries: 2 },
        });

        const result = await telegram.sendMessage(1, "hello");
        assert.equal(result.message_id, 2);
        assert.equal(calls, 2);
        assert.ok(times[1] - times[0] >= 950, `${times[1] - times[0]}`);
    } finally {
        server.close();
    }
});

test("other errors and too many retries are passed on", async () => {
    const limiter = new Limiter({ privateInterval: 0, retries: 1 });

    await assert.rejects(
        limiter.schedule("1", async () => { throw new TelegramError("sendMessage", { error_code: 403, description: "blocked" }); }),
        { code: 403 },
    );

    let attempts = 0;
    await assert.rejects(
        limiter.schedule("2", async () => {
            attempts++;
            throw new TelegramError("sendMessage", { error_code: 429, parameters: { retry_after: 0.05 } });
        }),
        { code: 429 },
    );
    assert.equal(attempts, 2);

    // the chat isn't stuck afterwards
    assert.equal(await limiter.schedule("1", async () => "ok"), "ok");
});
