import assert from "node:assert/strict";
import test from "node:test";

import { tabFromPathname, playerLayoutKey } from "./player-tab-model.ts";

test("player entry routes select their corresponding page", () => {
    assert.equal(tabFromPathname("/player"), "player");
    assert.equal(tabFromPathname("/player/discuss"), "discuss");
    assert.equal(tabFromPathname("/player/tags"), "tags");
});

test("covering the player preserves its provider key and returning keeps the same layout", () => {
    for (const playerPath of ["/player", "/player/discuss", "/player/tags"]) {
        let key = playerLayoutKey(playerPath);
        for (const path of [
            "/artist/42",
            "/collection/album/123",
            playerPath,
        ]) {
            key = playerLayoutKey(path, key);
            assert.equal(key, playerPath);
        }
    }
    assert.equal(
        playerLayoutKey("/player/discuss", "/player"),
        "/player/discuss",
    );
});
