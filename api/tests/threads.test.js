import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent } from "undici";

import threads from "../src/processing/services/threads.js";
import { extract, normalizeURL } from "../src/processing/url.js";

// a threads.com that redirects share links (from the app's share button)
// to the post, but only for clients that don't look like a browser
const threadsSite = (shares, onShare) => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    const site = agent.get("https://www.threads.com");

    for (const method of ["HEAD", "GET"]) {
        site.intercept({ path: (path) => path.startsWith("/share/"), method })
            .reply((options) => {
                onShare?.(options);
                const location = shares[options.path.slice("/share/".length)];
                return location
                    ? { statusCode: 302, data: "", responseOptions: { headers: { location } } }
                    : { statusCode: 404, data: "" };
            })
            .persist();
    }

    return agent;
}

// the post's page, with the post in the page's json data like threads has it
const postPage = (code) => `<html><script type="application/json" data-sjs>${JSON.stringify({
    require: [{ thread_items: [{ post: {
        code,
        media_type: 2,
        video_versions: [{ url: `https://video.example/${code}.mp4` }],
    } }] }],
})}</script></html>`;

const mockPages = (t, requests) => {
    const realFetch = globalThis.fetch;
    t.after(() => globalThis.fetch = realFetch);

    globalThis.fetch = async (input) => {
        const url = new URL(input);
        requests.push(url.toString());

        const code = url.pathname.match(/^\/t\/([\w-]+)$/)?.[1];
        if (code === "DgLrSzLncXD") return new Response(postPage(code));
        return new Response("", { status: 404 });
    }
}

test("threads share links are matched", () => {
    for (const url of [
        "https://www.threads.com/share/_lTUR33bT",
        "https://www.threads.net/share/_lTUR33bT",
        "https://threads.com/share/_lTUR33bT/",
    ]) {
        const { host, patternMatch } = extract(normalizeURL(url));
        assert.equal(host, "threads", url);
        assert.equal(patternMatch.shareId, "_lTUR33bT", url);
    }
});

test("threads share links are followed to the post", async (t) => {
    const pages = [];
    mockPages(t, pages);

    const shareRequests = [];
    const dispatcher = threadsSite({
        "_lTUR33bT": "https://www.threads.com/@someone/post/DgLrSzLncXD?xmt=AQG0g9&slof=1",
    }, (options) => shareRequests.push(options));

    const result = await threads({ shareId: "_lTUR33bT", dispatcher });

    assert.equal(result.urls, "https://video.example/DgLrSzLncXD.mp4");
    assert.equal(result.filename, "threads_DgLrSzLncXD.mp4");
    assert.deepEqual(pages, ["https://www.threads.com/t/DgLrSzLncXD"]);

    // threads answers a browser with a page instead of the redirect
    const userAgent = Object.entries(shareRequests[0].headers)
        .find(([name]) => name.toLowerCase() === "user-agent")?.[1];
    assert.match(userAgent, /^curl\//);
});

test("threads share links that don't lead to a post are an error", async (t) => {
    const pages = [];
    mockPages(t, pages);

    const dispatcher = threadsSite({
        // a share link of something that isn't a post
        "notAPost": "https://www.threads.com/login",
    });

    assert.deepEqual(await threads({ shareId: "notAPost", dispatcher }), { error: "fetch.short_link" });
    assert.deepEqual(await threads({ shareId: "unknown", dispatcher }), { error: "fetch.short_link" });
    assert.deepEqual(pages.filter(url => url.includes("/t/")), []);
});
