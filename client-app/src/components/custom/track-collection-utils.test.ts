import assert from "node:assert/strict";
import test from "node:test";
import type { MusicItem } from "@apple-musickit";

import {
    collectionSummary,
    collectionHeaderMetadata,
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

test("collection totals use every matching song and the shared album duration format", () => {
    const songs = Array.from({ length: 80 }, (_, i) =>
        track(String(i), "", 90),
    );
    assert.equal(collectionSummary(songs), "80 songs, 2 hours");
    assert.equal(collectionSummary([track("one", "", 61)]), "1 song, 1 minute");
    assert.equal(
        collectionSummary([track("one", "", 3660)]),
        "1 song, 1 hour 1 minute",
    );
    assert.equal(collectionSummary([], 0), "0 songs");
});

const song: MusicItem = {
    id: "song",
    resourceKind: "song",
    source: "catalog",
    title: "Song",
    playbackType: "song" as MusicItem["playbackType"],
    artistName: "Track artist",
    genres: ["Rock"],
    releaseDate: Date.parse("2024-01-01"),
};

test("playlist headers never borrow their first song's artist, genre, or year", () => {
    assert.deepEqual(
        collectionHeaderMetadata("playlist", "creator", undefined, song),
        {
            subtitle: "creator",
            summary: "",
        },
    );
    assert.deepEqual(
        collectionHeaderMetadata("playlist", undefined, undefined, song),
        {
            subtitle: undefined,
            summary: "",
        },
    );
    assert.equal(
        collectionHeaderMetadata(
            "playlist",
            undefined,
            { artistName: "curator" } as MusicItem,
            song,
        ).subtitle,
        "curator",
    );
});

test("album headers retain the artist, genre, and release year", () => {
    assert.deepEqual(
        collectionHeaderMetadata("album", undefined, undefined, song),
        {
            subtitle: "Track artist",
            summary: "Rock · 2024",
        },
    );
});
