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
        tabContentAboveTabBar: false,
    });
    const withHost = calculateScreenOverlayInsets({
        safeAreaBottom: 20,
        nativeTabBarHeight: 49,
        bottomBarsVisible: false,
        compactPlayerVisible: true,
        nativePlayerAccessory: false,
        tabContentAboveTabBar: false,
    });

    assert.equal(withoutHost.playerBottomInset, 20);
    assert.equal(withHost.playerBottomInset, 92);
    assert.ok(withHost.contentBottomInset > withoutHost.contentBottomInset);
});

test("native tab accessories do not get counted twice for floating actions", () => {
    const insets = calculateScreenOverlayInsets({
        safeAreaBottom: 34,
        nativeTabBarHeight: 49,
        bottomBarsVisible: true,
        compactPlayerVisible: true,
        nativePlayerAccessory: true,
        tabContentAboveTabBar: false,
    });

    assert.equal(insets.playerBottomInset, 155);
    assert.equal(insets.floatingActionBottom, 46);
});

test("android tab screens do not count the tab bar for floating actions", () => {
    const withPlayer = calculateScreenOverlayInsets({
        safeAreaBottom: 24,
        nativeTabBarHeight: 80,
        bottomBarsVisible: true,
        compactPlayerVisible: true,
        nativePlayerAccessory: false,
        tabContentAboveTabBar: true,
    });
    const withoutPlayer = calculateScreenOverlayInsets({
        safeAreaBottom: 24,
        nativeTabBarHeight: 80,
        bottomBarsVisible: true,
        compactPlayerVisible: false,
        nativePlayerAccessory: false,
        tabContentAboveTabBar: true,
    });

    assert.equal(withPlayer.floatingActionBottom, 84);
    assert.equal(withoutPlayer.floatingActionBottom, 12);
});

test("controls on a screen the tab bar floats over clear the whole bar", () => {
    const android = (compactPlayerVisible: boolean) =>
        calculateScreenOverlayInsets({
            safeAreaBottom: 24,
            nativeTabBarHeight: 80,
            bottomBarsVisible: true,
            compactPlayerVisible,
            nativePlayerAccessory: false,
            tabContentAboveTabBar: true,
        }).floatingOverTabBarBottom;
    // the bar and system inset, plus the floating player when it shows
    assert.equal(android(false), 116);
    assert.equal(android(true), 188);

    // UIKit already took the accessory player's space out of the screen
    const ios26 = calculateScreenOverlayInsets({
        safeAreaBottom: 34,
        nativeTabBarHeight: 49,
        bottomBarsVisible: true,
        compactPlayerVisible: true,
        nativePlayerAccessory: true,
        tabContentAboveTabBar: false,
    });
    assert.equal(ios26.floatingOverTabBarBottom, 95);

    // with the bars hidden for the keyboard, only the player and safe area
    const hidden = calculateScreenOverlayInsets({
        safeAreaBottom: 24,
        nativeTabBarHeight: 80,
        bottomBarsVisible: false,
        compactPlayerVisible: false,
        nativePlayerAccessory: false,
        tabContentAboveTabBar: true,
    });
    assert.equal(hidden.floatingOverTabBarBottom, 36);
});
