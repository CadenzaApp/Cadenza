import assert from "node:assert/strict";
import test from "node:test";

import {
    catalogIdsToFetch,
    queryQueueIds,
    resolvedTracks,
    uniqueBy,
} from "./paged-tracks.ts";

const inLibrary = (songId: string) => songId.startsWith("lib");

test("only ids the library cannot resolve are fetched", () => {
    assert.deepEqual(
        catalogIdsToFetch(["lib1", "cat1", "lib2", "cat2"], 4, inLibrary, 25),
        ["cat1", "cat2"],
    );
});

test("fetching stops at whole chunks past the window", () => {
    const songIds = Array.from({ length: 10 }, (_, index) => `cat${index}`);
    // three ids in the window need one chunk of two, then another
    assert.deepEqual(catalogIdsToFetch(songIds, 3, inLibrary, 2), [
        "cat0",
        "cat1",
        "cat2",
        "cat3",
    ]);
    // nothing in the window needs fetching, so nothing is
    assert.deepEqual(
        catalogIdsToFetch(["lib1", "lib2", "cat1"], 2, inLibrary, 2),
        [],
    );
});

test("growing the window keeps every chunk already asked for", () => {
    const songIds = Array.from({ length: 40 }, (_, index) =>
        index % 3 === 0 ? `lib${index}` : `cat${index}`,
    );
    const chunk = 5;
    const first = catalogIdsToFetch(songIds, 10, inLibrary, chunk);
    const second = catalogIdsToFetch(songIds, 20, inLibrary, chunk);

    assert.equal(first.length % chunk, 0);
    assert.deepEqual(second.slice(0, first.length), first);
});

test("the last chunk of the whole list may be short", () => {
    assert.deepEqual(catalogIdsToFetch(["cat1", "cat2"], 2, inLibrary, 25), [
        "cat1",
        "cat2",
    ]);
});

const tracks = new Map([
    ["a", { id: "A" }],
    ["b", { id: "B" }],
    ["d", { id: "D" }],
    ["b-library", { id: "B" }],
]);
const trackFor = (songId: string) => tracks.get(songId);
const keyOf = (track: { id: string }) => track.id;

test("an unresolved id ends the list while lookups are pending", () => {
    assert.deepEqual(
        resolvedTracks(["a", "b", "c", "d"], 4, trackFor, keyOf, true),
        { tracks: [{ id: "A" }, { id: "B" }], consumedCount: 2 },
    );
});

test("an id with no track is skipped once nothing is pending", () => {
    assert.deepEqual(
        resolvedTracks(["a", "b", "c", "d"], 4, trackFor, keyOf, false),
        {
            tracks: [{ id: "A" }, { id: "B" }, { id: "D" }],
            consumedCount: 4,
        },
    );
});

test("only the requested window is shown", () => {
    assert.deepEqual(
        resolvedTracks(["a", "b", "d"], 2, trackFor, keyOf, false),
        { tracks: [{ id: "A" }, { id: "B" }], consumedCount: 2 },
    );
    assert.deepEqual(resolvedTracks(["a"], 50, trackFor, keyOf, false), {
        tracks: [{ id: "A" }],
        consumedCount: 1,
    });
});

test("two ids for one track show it once", () => {
    assert.deepEqual(
        resolvedTracks(["b", "a", "b-library"], 3, trackFor, keyOf, false),
        { tracks: [{ id: "B" }, { id: "A" }], consumedCount: 3 },
    );
});

test("a query plays every certain song and only the loaded others", () => {
    const songs = [
        { songId: "mine-1", certain: true },
        { songId: "found-1", certain: false },
        { songId: "found-2", certain: false },
        { songId: "mine-2", certain: true },
        { songId: "found-3", certain: false },
    ];
    assert.deepEqual(queryQueueIds(songs, 2), ["mine-1", "found-1", "mine-2"]);
    assert.deepEqual(queryQueueIds(songs, 0), ["mine-1", "mine-2"]);
    assert.deepEqual(
        queryQueueIds(songs, songs.length),
        songs.map((song) => song.songId),
    );
});

test("uniqueBy keeps the first of each", () => {
    assert.deepEqual(
        uniqueBy(
            [
                { id: "a", n: 1 },
                { id: "b", n: 2 },
                { id: "a", n: 3 },
            ],
            (value) => value.id,
        ),
        [
            { id: "a", n: 1 },
            { id: "b", n: 2 },
        ],
    );
});
