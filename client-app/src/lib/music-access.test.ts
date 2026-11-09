import assert from "node:assert/strict";
import test from "node:test";

import { canUse, musicTier, unlockAction } from "./music-access.ts";

test("no apple music is previews, whatever the subscription says", () => {
    assert.equal(
        musicTier({ isConnected: false, canPlayCatalogContent: true }),
        "preview",
    );
});

test("connected without a subscription keeps the library but not full songs", () => {
    const tier = musicTier({
        isConnected: true,
        canPlayCatalogContent: false,
    });
    assert.equal(tier, "connected");
    assert.equal(canUse(tier, "library"), true);
    assert.equal(canUse(tier, "fullPlayback"), false);
});

test("an unknown subscription counts as full, so subscribers never see previews", () => {
    assert.equal(
        musicTier({ isConnected: true, canPlayCatalogContent: undefined }),
        "full",
    );
});

test("previews still get the catalog and nothing that needs an account", () => {
    assert.equal(canUse("preview", "catalog"), true);
    assert.equal(canUse("preview", "library"), false);
    assert.equal(canUse("preview", "playlists"), false);
});

test("a gate says connect or subscribe by what the feature needs", () => {
    assert.equal(unlockAction("library"), "connect");
    assert.equal(unlockAction("fullPlayback"), "subscribe");
});
