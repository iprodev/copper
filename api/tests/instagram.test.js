import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePostPage } from "../src/processing/services/instagram.js";

// a post page like instagram's: the post is deep in a json script
const page = (post) => `<html><head>
<script type="application/json" data-sjs>{"require":[["ScheduledServerJS","handle",null,[{"__bbox":{"require":[["RelayPrefetchedStreamCache","next",[],["adp_x",{"__bbox":{"result":{"data":{"xig_polaris_media":{"if_not_gated_logged_out":${JSON.stringify(post)}}}}}}]]]}}]]]}</script>
<script type="application/json">{"other":"data"}</script>
</head></html>`;

test("a reel on the post page, with its video links", () => {
    const reel = {
        code: "DeIUG4esBtK",
        media_type: 2,
        product_type: "clips",
        video_versions: [ { type: 101, url: "https://cdn.example/101.mp4" }, { type: 102, url: "https://cdn.example/102.mp4" } ],
        image_versions2: { candidates: [ { url: "https://cdn.example/cover.jpg" } ] },
    };
    assert.deepEqual(parsePostPage(page(reel)), reel);
});

test("photos and carousels on the post page", () => {
    const photo = { media_type: 1, image_versions2: { candidates: [ { url: "https://cdn.example/a.jpg" } ] } };
    assert.deepEqual(parsePostPage(page(photo)), photo);

    const carousel = { media_type: 8, carousel_media: [ photo ] };
    assert.deepEqual(parsePostPage(page(carousel)), carousel);
});

test("a video without its links isn't taken from the post page", () => {
    // so the cover image isn't saved as a photo instead of the video
    assert.equal(parsePostPage(page({
        media_type: 2,
        image_versions2: { candidates: [ { url: "https://cdn.example/cover.jpg" } ] },
    })), undefined);
});

test("pages without the post (e.g. instagram's login page when rate-limited)", () => {
    assert.equal(parsePostPage(undefined), undefined);
    assert.equal(parsePostPage("<html><body>log in to continue</body></html>"), undefined);
    assert.equal(parsePostPage('<script type="application/json">{"xig_polaris_media": broken</script>'), undefined);
    assert.equal(parsePostPage(page(null)), undefined);
});

// instagram's answers for a post the owner limited by age, logged out
const gatedInstagram = (oembed) => async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/oembed/") {
        return Response.json(oembed, { status: 400 });
    }
    // nothing else shows the post either
    return new Response("<html></html>", { status: 200 });
}

test("a post limited by age is an age error, not \"nothing found\"", async (t) => {
    const { default: instagram } = await import("../src/processing/services/instagram.js");
    const realFetch = globalThis.fetch;
    t.after(() => globalThis.fetch = realFetch);

    globalThis.fetch = gatedInstagram({
        message: "geoblock_required",
        gating_type: "unappealable",
        title: "People under 15 can't see this content",
        description: "This account has set limits on who can see their content.",
    });
    assert.deepEqual(await instagram({ postId: "DgK_f78x8Sp" }), { error: "content.post.age" });

    // limited to some countries
    globalThis.fetch = gatedInstagram({
        message: "geoblock_required",
        gating_type: "unappealable",
        title: "This content isn't available in your country",
    });
    assert.deepEqual(await instagram({ postId: "DgK_f78x8Sp" }), { error: "content.region" });
});
