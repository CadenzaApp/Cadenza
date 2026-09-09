import assert from "node:assert/strict";
import test from "node:test";

import type { MusicItem } from "@apple-musickit";

import { nextSort, sortTracks } from "./sort-tracks.ts";

function track(
    id: string,
    title: string,
    libraryAddedDate?: number,
): MusicItem {
    return { id, title, libraryAddedDate } as MusicItem;
}

test("switching fields preserves the current direction", () => {
    assert.deepEqual(
        nextSort({ option: "album", direction: "descending" }, "title"),
        { option: "title", direction: "descending" },
    );
});

test("date-added sorting orders known dates deterministically", () => {
    const songs = [track("b", "Same", 20), track("a", "Same", 10)];

    assert.deepEqual(
        sortTracks(songs, {
            option: "dateAdded",
            direction: "descending",
        }).map(({ id }) => id),
        ["b", "a"],
    );
});
