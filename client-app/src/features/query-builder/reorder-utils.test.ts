import assert from "node:assert/strict";
import test from "node:test";
import {
    completeReorderDrop,
    edgeScrollDelta,
    reorderLayout,
    reorderIndexAtCenter,
    moveReorderKey,
    reorderLayoutMatches,
} from "./reorder-utils.ts";
const order = ["short", "tall", "medium"];
const heights = { short: 80, tall: 240, medium: 120 };
test("variable-height reorder positions use measured heights", () => {
    assert.equal(reorderLayout(order, heights).tops.medium, 320);
    const moved = moveReorderKey(
        order,
        "short",
        reorderIndexAtCenter(
            order,
            reorderLayout(order, heights).centers,
            "short",
            410,
        ),
    );
    assert.deepEqual(moved, ["tall", "medium", "short"]);
    assert.equal(reorderLayout(moved, heights).tops.short, 360);
    assert.deepEqual(
        moveReorderKey(
            order,
            "medium",
            reorderIndexAtCenter(
                order,
                reorderLayout(order, heights).centers,
                "medium",
                10,
            ),
        ),
        ["medium", "short", "tall"],
    );
});
test("moving back over the original position restores the original order", () => {
    assert.deepEqual(
        moveReorderKey(
            order,
            "tall",
            reorderIndexAtCenter(
                order,
                reorderLayout(order, heights).centers,
                "tall",
                200,
            ),
        ),
        order,
    );
    assert.deepEqual(
        moveReorderKey(
            ["only"],
            "only",
            reorderIndexAtCenter(["only"], { only: 45 }, "only", -100),
        ),
        ["only"],
    );
});
test("edge scrolling tapers, stops in the middle, and scales with frame duration", () => {
    assert.equal(edgeScrollDelta(0, 0, 16), 0);
    assert.equal(edgeScrollDelta(0, 400, 0), 0);
    assert.equal(edgeScrollDelta(200, 400, 16), 0);
    assert.equal(edgeScrollDelta(0, 400, 16), -9.6);
    assert.equal(edgeScrollDelta(400, 400, 16), 9.6);
    assert.equal(edgeScrollDelta(36, 400, 16), -4.8);
    assert.equal(edgeScrollDelta(400, 400, 32), 19.2);
    assert.equal(edgeScrollDelta(400, 400, 500), 19.2);
});

test("two groups can swap repeatedly and only finish when native layout agrees", () => {
    let keys = ["a", "b"];
    const sizes = { a: 128, b: 192 };
    for (let i = 0; i < 10; i++) {
        const oldLayout = reorderLayout(keys, sizes);
        const moving = keys[0];
        const next = moveReorderKey(
            keys,
            moving,
            reorderIndexAtCenter(keys, oldLayout.centers, moving, 1000),
        );
        const projected = reorderLayout(next, sizes);
        assert.equal(
            reorderLayoutMatches(next, keys, projected.tops, oldLayout.tops),
            false,
        );
        assert.equal(
            reorderLayoutMatches(next, next, projected.tops, oldLayout.tops),
            false,
        );
        assert.equal(
            reorderLayoutMatches(next, next, projected.tops, projected.tops),
            true,
        );
        assert.equal(
            projected.tops[next[1]],
            sizes[next[0] as keyof typeof sizes],
        );
        keys = next;
    }
});

for (const outcome of ["success", "cancel", "error"] as const) {
    test(`reorder ${outcome} always completes and restores order when needed`, async () => {
        let current = ["b", "a"];
        const calls: string[] = [];
        await completeReorderDrop({
            drop: async () => {
                if (outcome === "error") throw new Error("drop failed");
                return outcome === "success";
            },
            rollback: () => {
                current = ["a", "b"];
                calls.push("rollback");
            },
            complete: () => calls.push("complete"),
            onError: () => calls.push("error"),
        });
        assert.deepEqual(
            current,
            outcome === "success" ? ["b", "a"] : ["a", "b"],
        );
        assert.deepEqual(
            calls,
            outcome === "success"
                ? ["complete"]
                : outcome === "cancel"
                  ? ["rollback", "complete"]
                  : ["error", "rollback", "complete"],
        );
    });
}
