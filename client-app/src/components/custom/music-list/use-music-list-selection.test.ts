import assert from "node:assert/strict";
import test from "node:test";

import type { MusicItem } from "@apple-musickit";

import { tracksSelectedInDisplayOrder } from "./selection-utils.ts";

function track(id: string): MusicItem {
    return { id, title: id } as MusicItem;
}

test("selection follows display order and ignores tracks no longer displayed", () => {
    const displayed = [track("third"), track("first")];
    const selected = new Set(["first", "removed", "third"]);

    assert.deepEqual(
        tracksSelectedInDisplayOrder(displayed, selected).map(({ id }) => id),
        ["third", "first"],
    );
});
