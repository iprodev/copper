import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRequest, getIP, createResponse } from "../src/processing/request.js";

test("request defaults are applied", async () => {
    const { success, data } = await normalizeRequest({ url: "https://youtu.be/dQw4w9WgXcQ?si=tracking" });

    assert.ok(success);
    assert.equal(data.url.href, "https://youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(data.audioFormat, "mp3");
    assert.equal(data.videoQuality, "1080");
    assert.equal(data.downloadMode, "auto");
    assert.equal(data.localProcessing, "disabled");
    assert.equal(data.alwaysProxy, false);
});

test("legacy boolean localProcessing is converted", async () => {
    const on = await normalizeRequest({ url: "https://x.com/a/status/1", localProcessing: true });
    const off = await normalizeRequest({ url: "https://x.com/a/status/1", localProcessing: false });

    assert.equal(on.data.localProcessing, "preferred");
    assert.equal(off.data.localProcessing, "disabled");
});

test("invalid requests are rejected", async () => {
    const invalid = [
        { url: "not a url" },
        { url: "" },
        { url: "https://youtube.com/watch?v=1", unknownKey: true },
        { url: "https://youtube.com/watch?v=1", videoQuality: "999" },
        { url: "https://youtube.com/watch?v=1", audioFormat: "flac" },
        { url: "https://youtube.com/watch?v=1", youtubeDubLang: "en; rm -rf" },
        { url: "https://youtube.com/watch?v=1", alwaysProxy: "yes" },
    ];

    for (const body of invalid) {
        const { success } = await normalizeRequest(body);
        assert.equal(success, false, JSON.stringify(body));
    }
});

test("getIP keeps ipv4, strips ipv4-mapped prefix and masks ipv6", () => {
    assert.equal(getIP({ ip: "192.0.2.1" }), "192.0.2.1");
    assert.equal(getIP({ ip: "::ffff:192.0.2.1" }), "192.0.2.1");
    assert.equal(getIP({ ip: "2001:db8:1:2ff:3:4:5:6" }), "2001:db8:1:200::");
    assert.equal(getIP({ ip: "2001:db8:1:2:3:4:5:6" }, 32), "2001:db8::");
});

test("createResponse shapes", () => {
    const error = createResponse("error", { code: "error.api.link.invalid" });
    assert.equal(error.status, 400);
    assert.deepEqual(error.body, { status: "error", error: { code: "error.api.link.invalid", context: undefined } });

    const redirect = createResponse("redirect", { url: "https://example.com/a.mp4", filename: "a.mp4" });
    assert.equal(redirect.status, 200);
    assert.deepEqual(redirect.body, { status: "redirect", url: "https://example.com/a.mp4", filename: "a.mp4" });

    const critical = createResponse("critical", { code: "error.api.fetch.critical" });
    assert.equal(critical.status, 500);
    assert.equal(critical.body.critical, true);

    // local processing without a filename is invalid
    assert.equal(createResponse("local-processing", { type: "merge", url: ["a"] }).status, 500);
});
