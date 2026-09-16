import assert from "node:assert/strict";
import test from "node:test";

import { averageArtworkColors } from "./artwork-color-utils.ts";

test("averages the available artwork colors channel by channel", () => {
    assert.equal(
        averageArtworkColors(["#ff0000", "#00ff00", "#0000ff", "#ffffff"]),
        "#808080",
    );
    assert.equal(averageArtworkColors([null, "#204060", undefined]), "#204060");
    assert.equal(averageArtworkColors([null, "invalid"]), null);
});
