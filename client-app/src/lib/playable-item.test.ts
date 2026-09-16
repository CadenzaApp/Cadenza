import assert from "node:assert/strict";
import test from "node:test";

import type { MusicItem } from "@apple-musickit";

import { isTrackInCollection, samePlayableItem } from "./playable-item.ts";

function item(id: string, extra: Partial<MusicItem> = {}) {
    return {
        id,
        title: id,
        resourceKind: "song",
        source: "catalog",
        playbackType: "song",
        ...extra,
    } as MusicItem;
}

test("playable identity crosses library and catalog identifiers", () => {
    assert.equal(
        samePlayableItem(
            item("library", { catalogId: "catalog" }),
            item("catalog"),
        ),
        true,
    );
    assert.equal(samePlayableItem(item("one"), item("two")), false);
    assert.equal(
        samePlayableItem(
            item("", { playbackId: "play" }),
            item("other", { libraryId: "play" }),
        ),
        true,
    );
});

test("album membership can be known before its track page loads", () => {
    assert.equal(
        isTrackInCollection(
            item("song", { albumID: "album" }),
            "album",
            "album",
            [],
        ),
        true,
    );
    assert.equal(
        isTrackInCollection(item("song"), "playlist", "playlist", [
            item("song"),
        ]),
        true,
    );
    assert.equal(
        isTrackInCollection(item("other"), "playlist", "playlist", [
            item("song"),
        ]),
        false,
    );
});
