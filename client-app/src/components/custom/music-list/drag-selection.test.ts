import assert from "node:assert/strict";
import test from "node:test";
import { rowAtPosition, selectionScrollSpeed } from "./drag-selection.ts";
import {
    previewDragSelection,
    reduceMusicListSelection,
} from "./selection-utils.ts";

test("drag hit testing respects variable-height group headers and content offsets", () => {
    const layouts = [
        { y: 0, height: 52 },
        { y: 52, height: 73 },
        { y: 125, height: 73 },
    ];
    assert.equal(
        rowAtPosition(3, 52, (i) => layouts[i]),
        1,
    );
    assert.equal(
        rowAtPosition(3, 197, (i) => layouts[i]),
        2,
    );
    assert.equal(
        rowAtPosition(3, -1, (i) => layouts[i]),
        -1,
    );
    assert.equal(
        rowAtPosition(3, 198, (i) => layouts[i]),
        -1,
    );
});

test("edge scrolling goes in either direction and stops away from edges", () => {
    assert.equal(selectionScrollSpeed(300, 600), 0);
    assert.equal(selectionScrollSpeed(0, 600), -600);
    assert.equal(selectionScrollSpeed(600, 600), 600);
    assert.equal(selectionScrollSpeed(36, 600), -300);
});

test("separate drag spans add to the selection without toggling earlier songs", () => {
    let selection: ReadonlySet<string> = new Set(["old"]);
    selection = reduceMusicListSelection(selection, {
        type: "add_span",
        ids: ["a", "b", "c"],
    });
    selection = reduceMusicListSelection(selection, {
        type: "add_span",
        ids: ["f", "e", "d"],
    });
    selection = reduceMusicListSelection(selection, {
        type: "add_span",
        ids: ["c", "b"],
    });
    assert.deepEqual([...selection], ["old", "a", "b", "c", "f", "e", "d"]);
});

test("reversing a live drag shrinks only its own span", () => {
    const base = new Set(["old", "c"]);
    assert.deepEqual(
        [...previewDragSelection(base, ["a", "b", "c", "d"])],
        ["old", "c", "a", "b", "d"],
    );
    const reversed = previewDragSelection(base, ["a", "b"]);
    assert.deepEqual([...reversed], ["old", "c", "a", "b"]);
    assert.deepEqual(
        [...previewDragSelection(reversed, ["f", "g"])],
        ["old", "c", "a", "b", "f", "g"],
    );
});
