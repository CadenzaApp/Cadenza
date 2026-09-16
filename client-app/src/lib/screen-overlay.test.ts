import assert from "node:assert/strict";
import test from "node:test";

import { calculateScreenOverlayInsets } from "./screen-overlay-geometry.ts";

test("pushed screens reserve space only when they host the compact player", () => {
    const withoutHost = calculateScreenOverlayInsets({
        safeAreaBottom: 20,
        nativeTabBarHeight: 49,
        bottomBarsVisible: false,
        compactPlayerVisible: false,
        nativePlayerAccessory: false,
    });
    const withHost = calculateScreenOverlayInsets({
        safeAreaBottom: 20,
        nativeTabBarHeight: 49,
        bottomBarsVisible: false,
        compactPlayerVisible: true,
        nativePlayerAccessory: false,
    });

    assert.equal(withoutHost.playerBottomInset, 20);
    assert.equal(withHost.playerBottomInset, 92);
    assert.ok(withHost.contentBottomInset > withoutHost.contentBottomInset);
});
