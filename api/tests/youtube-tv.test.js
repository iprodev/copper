import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent } from "undici";

import { adSeconds, parseFormat, getTvUrls, runSolver } from "../src/processing/helpers/youtube-tv.js";

const innertube = {
    session: {
        player: { player_id: "abcd1234", signature_timestamp: 20779 },
        context: { client: { visitorData: "visitor" } },
    },
};

// a dispatcher that answers like youtube's player endpoint
const youtube = (playerResponse, onRequest) => {
    const agent = new MockAgent();
    agent.disableNetConnect();
    agent.get("https://www.youtube.com")
        .intercept({ path: "/youtubei/v1/player?prettyPrint=false", method: "POST" })
        .reply(200, (options) => {
            onRequest?.(options);
            return playerResponse;
        }, { headers: { "content-type": "application/json" } });
    return agent;
}

const preRoll = (skipOffsetMilliseconds) => ({
    adPlacementRenderer: {
        config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_START" } },
        renderer: { instreamVideoAdRenderer: { skipOffsetMilliseconds } },
    },
});

test("pre-roll ads are added up, other ads aren't", () => {
    assert.equal(adSeconds({}), 0);

    assert.equal(adSeconds({
        adPlacements: [
            preRoll("5000"),
            { adPlacementRenderer: {
                config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_MILLISECONDS" } },
                renderer: { instreamVideoAdRenderer: { skipOffsetMilliseconds: "9000" } },
            } },
        ],
    }), 5);

    // ad slots, with the length of unskippable ads
    assert.equal(adSeconds({
        adSlots: [{ adSlotRenderer: {
            adSlotMetadata: { triggerEvent: "SLOT_TRIGGER_EVENT_BEFORE_CONTENT" },
            fulfillmentContent: { fulfilledLayout: { playerBytesAdLayoutRenderer: { renderingContent: {
                playerBytesSequentialLayoutRenderer: { sequentialLayouts: [
                    { playerBytesAdLayoutRenderer: { renderingContent: {
                        instreamVideoAdRenderer: { playerVars: "length_seconds=6&foo=bar" },
                    } } },
                    { playerBytesAdLayoutRenderer: { renderingContent: {
                        instreamVideoAdRenderer: { skipOffsetMilliseconds: "1500" },
                    } } },
                ] },
            } } } },
        } }],
    }), 7.5);
});

test("formats with plain and ciphered links", () => {
    assert.equal(parseFormat({ url: "https://rr1.googlevideo.com/videoplayback?itag=137" }).url.searchParams.get("itag"), "137");

    const ciphered = parseFormat({
        signatureCipher: new URLSearchParams({
            s: "challenge", sp: "sig", url: "https://rr1.googlevideo.com/videoplayback?itag=140",
        }).toString(),
    });
    assert.equal(ciphered.s, "challenge");
    assert.equal(ciphered.sp, "sig");
    assert.equal(ciphered.url.searchParams.get("itag"), "140");

    assert.equal(parseFormat({ signatureCipher: "s=only" }), undefined);
});

test("tv links of the same formats, after the pre-roll ad", async () => {
    let request;
    const dispatcher = youtube({
        playabilityStatus: { status: "OK" },
        adPlacements: [ preRoll("300") ],
        streamingData: { adaptiveFormats: [
            { itag: 137, url: "https://rr1.googlevideo.com/videoplayback?itag=137&tv=1" },
            { itag: 140, audioTrack: { id: "de.4" }, url: "https://rr1.googlevideo.com/videoplayback?itag=140&lang=de" },
            { itag: 140, audioTrack: { id: "en.4" }, url: "https://rr1.googlevideo.com/videoplayback?itag=140&lang=en" },
        ] },
    }, options => request = options);

    const start = Date.now();
    const urls = await getTvUrls({
        id: "9bZkp7q19f0",
        formats: [ { itag: 137 }, { itag: 140, audioTrackId: "en.4" } ],
        innertube,
        dispatcher,
    });

    assert.deepEqual(urls, [
        "https://rr1.googlevideo.com/videoplayback?itag=137&tv=1",
        "https://rr1.googlevideo.com/videoplayback?itag=140&lang=en",
    ]);
    // the links only work once the ad would be over
    assert.ok(Date.now() - start >= 300);

    // asked as the tv client, for the same video
    const body = JSON.parse(request.body);
    assert.equal(body.videoId, "9bZkp7q19f0");
    assert.equal(body.context.client.clientName, "TVHTML5");
    assert.equal(body.playbackContext.contentPlaybackContext.signatureTimestamp, 20779);
    assert.equal(request.headers["x-goog-visitor-id"], "visitor");
});

test("nothing when the tv client can't help", async () => {
    const formats = [ { itag: 137 } ];
    const ok = { status: "OK" };
    const format137 = { itag: 137, url: "https://rr1.googlevideo.com/videoplayback?itag=137" };

    // not playable as a tv
    assert.equal(await getTvUrls({ id: "x", formats, innertube,
        dispatcher: youtube({ playabilityStatus: { status: "LOGIN_REQUIRED" } }) }), undefined);

    // the format isn't there
    assert.equal(await getTvUrls({ id: "x", formats, innertube,
        dispatcher: youtube({ playabilityStatus: ok, streamingData: { adaptiveFormats: [] } }) }), undefined);

    // too long to wait for the ads
    assert.equal(await getTvUrls({ id: "x", formats, innertube,
        dispatcher: youtube({ playabilityStatus: ok, adPlacements: [ preRoll("60000") ],
            streamingData: { adaptiveFormats: [ format137 ] } }) }), undefined);

    // no player to solve challenges with
    assert.equal(await getTvUrls({ id: "x", formats, innertube: {}, dispatcher: youtube({}) }), undefined);
});

test("yt-dlp's solver runs in an isolate and reports bad players", async () => {
    const request = { type: "n", challenges: [ "abc" ] };

    // javascript, but not a youtube player
    await assert.rejects(
        runSolver({ type: "player", player: "var a = 1;", requests: [ request ] }),
        /^Error: challenge solver: unexpected structure/
    );

    // not even javascript
    await assert.rejects(
        runSolver({ type: "player", player: "this isn't a player", requests: [ request ] }),
        /^Error: challenge solver: .*Unexpected token/
    );
});
