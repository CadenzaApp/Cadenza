import assert from "node:assert/strict";
import test from "node:test";
import {
    createDragHoverStore,
    DragMeasurementSession,
    pickDropZone,
    intersectDropRects,
    measureDropRect,
    movedDropRect,
} from "./drag-utils.ts";

test("quick release waits for measurement instead of losing the drop", async () => {
    const sessions = new DragMeasurementSession<string>();
    let complete!: (value: string) => void;
    const version = sessions.begin(
        () =>
            new Promise((resolve) => {
                complete = resolve;
            }),
    );
    let finished = false;
    const release = sessions.ready(version).then((result) => {
        finished = true;
        return result;
    });
    await Promise.resolve();
    assert.equal(finished, false);
    complete("destination");
    assert.equal(await release, "destination");
});
test("cancellation and a newer pickup invalidate an old pending release", async () => {
    const sessions = new DragMeasurementSession<string>();
    let complete!: (value: string) => void;
    const old = sessions.begin(
        () =>
            new Promise((resolve) => {
                complete = resolve;
            }),
    );
    const release = sessions.ready(old);
    sessions.cancel();
    const next = sessions.begin(async () => "new");
    complete("old");
    assert.equal(await release, null);
    assert.equal(await sessions.ready(next), "new");
});
test("an ineligible overlapping target cannot hide an eligible destination", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const zones = [
        { key: "own-card", rect, priority: 30, target: "own" },
        { key: "workspace", rect, priority: 10, target: "new-group" },
    ];
    assert.equal(
        pickDropZone(zones, 50, 50, (target) => target !== "own")?.key,
        "workspace",
    );
    assert.equal(
        pickDropZone(zones, 101, 50, () => true),
        undefined,
    );
});

test("scrolling adjusts a target while its visible region remains anchored", () => {
    const visible = { x: 0, y: 100, width: 300, height: 250 };
    const card = { x: 20, y: 160, width: 260, height: 100 };
    const moved = movedDropRect(card, 80, 0);
    const clipped = intersectDropRects(moved, visible)!;
    assert.deepEqual(clipped, { x: 20, y: 100, width: 260, height: 80 });
    assert.equal(
        pickDropZone(
            [{ key: "card", rect: clipped, target: "card", priority: 30 }],
            50,
            90,
            () => true,
        ),
        undefined,
    );
    assert.equal(
        pickDropZone(
            [{ key: "card", rect: clipped, target: "card", priority: 30 }],
            50,
            120,
            () => true,
        )?.key,
        "card",
    );
});
test("translated palette drop area cannot extend behind navigation or offscreen", () => {
    const sheet = movedDropRect(
        { x: 0, y: 350, width: 300, height: 450 },
        0,
        200,
    );
    const visible = intersectDropRects(sheet, {
        x: 0,
        y: 0,
        width: 300,
        height: 730,
    });
    assert.deepEqual(visible, { x: 0, y: 550, width: 300, height: 180 });
    assert.equal(
        intersectDropRects(
            { x: 0, y: 0, width: 300, height: 90 },
            { x: 0, y: 100, width: 300, height: 100 },
        ),
        null,
    );
});

test("a detached or unresponsive native target cannot strand a release", async () => {
    assert.equal(await measureDropRect(null), null);
    assert.equal(
        await measureDropRect({
            measureInWindow() {
                throw new Error("detached");
            },
        }),
        null,
    );
    assert.equal(await measureDropRect({ measureInWindow() {} }, 1), null);
    assert.deepEqual(
        await measureDropRect({
            measureInWindow(callback) {
                callback(5, 10, 50, 20);
            },
        }),
        { x: 5, y: 10, width: 50, height: 20 },
    );
});

test("hover notifies only the old and new targets, and ignores repeated positions", () => {
    const store = createDragHoverStore();
    const notifications: string[] = [];
    const stopA = store.subscribe("a", () => notifications.push("a"));
    store.subscribe("b", () => notifications.push("b"));
    store.subscribe("unrelated", () => notifications.push("unrelated"));
    store.set("a");
    store.set("a");
    assert.deepEqual(notifications, ["a"]);
    store.set("b");
    assert.equal(store.isHovered("a"), false);
    assert.equal(store.isHovered("b"), true);
    assert.deepEqual(notifications, ["a", "a", "b"]);
    stopA();
    store.set(null);
    store.set("a");
    assert.deepEqual(notifications, ["a", "a", "b", "b"]);
});
