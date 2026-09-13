import assert from "node:assert/strict";
import test from "node:test";

import type { MusicItem } from "@apple-musickit";

import {
    reduceMusicListSelection,
    tracksSelectedInDisplayOrder,
} from "./selection-utils.ts";

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

test("selection transitions add, toggle, prune, and clear IDs", () => {
    let selection: ReadonlySet<string> = new Set();
    selection = reduceMusicListSelection(selection, {
        type: "select",
        id: "second",
    });
    selection = reduceMusicListSelection(selection, {
        type: "toggle",
        id: "first",
    });
    assert.deepEqual([...selection], ["second", "first"]);

    selection = reduceMusicListSelection(selection, {
        type: "reconcile",
        availableIds: new Set(["first"]),
    });
    assert.deepEqual([...selection], ["first"]);

    selection = reduceMusicListSelection(selection, { type: "clear" });
    assert.equal(selection.size, 0);
});
