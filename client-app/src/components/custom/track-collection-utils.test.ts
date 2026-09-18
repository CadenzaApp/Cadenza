import assert from "node:assert/strict";
import test from "node:test";
import type { MusicItem } from "@apple-musickit";

import {
    collectionArtworkGrid,
    collectionArtworkGridTracks,
    formatTrackCollectionSummary,
    rankedArtworkUrls,
} from "./track-collection-utils.ts";

function track(
    id: string,
    artworkUrl: string,
    songDuration: number,
): MusicItem {
    return {
        id,
        resourceKind: "song",
        source: "catalog",
        title: id,
        artworkUrl,
        songDuration,
        playbackType: "song" as MusicItem["playbackType"],
    };
}

test("artwork ranking sums duration plus one minute for every song", () => {
    const tracks = [
        track("a1", "artwork-a", 120),
        track("a2", "artwork-a", 120),
        track("a3", "artwork-a", 120),
        track("b1", "artwork-b", 420),
    ];

    assert.deepEqual(rankedArtworkUrls(tracks), ["artwork-a", "artwork-b"]);
    assert.deepEqual(collectionArtworkGrid(tracks), [
        "artwork-a",
        "artwork-b",
        "artwork-a",
        "artwork-b",
    ]);
    assert.deepEqual(
        collectionArtworkGridTracks(tracks).map(({ id }) => id),
        ["a1", "b1", "a1", "b1"],
    );
});

test("collection summary includes track count and complete duration", () => {
    const tracks = [
        track("a", "artwork-a", 3600),
        track("b", "artwork-b", 467),
    ];
    assert.equal(
        formatTrackCollectionSummary(tracks),
        "2 tracks (1 hr 7 min 47 sec)",
    );
});

test("one unique artwork renders as one image instead of a repeated grid", () => {
    const tracks = [
        track("a", "shared-artwork", 120),
        track("b", "shared-artwork", 180),
    ];

    assert.deepEqual(collectionArtworkGrid(tracks), ["shared-artwork"]);
});

test("collection summary omits zero-valued minute units", () => {
    const tracks = [track("a", "artwork-a", 3640)];

    assert.equal(formatTrackCollectionSummary(tracks), "1 track (1 hr 40 sec)");
});
