import assert from "node:assert/strict";
import test from "node:test";

import {
    calculateScreenOverlayInsets,
    playerHostIsActive,
    bottomActionPlacement,
    nativePlayerAccessoryEnabled,
    selectionOverlayOffsets,
    auxiliaryControlY,
    selectionOffsetAboveNativePlayer,
    playerDragProgress,
    playerReleaseTarget,
    playerTouchMoved,
    clampBubblePosition,
    bubbleNearHome,
} from "./screen-overlay-geometry.ts";

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
    assert.equal(withHost.playerBottomInset, 80);
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

    assert.equal(insets.playerBottomInset, 143);
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

    assert.equal(withPlayer.floatingActionBottom, 72);
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
    assert.equal(android(true), 176);

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

test("native scroll docking is available for expanded tab playback", () => {
    const state = {
        supported: true,
        inTabs: true,
        hasTrack: true,
        collapsed: false,
    };
    assert.equal(nativePlayerAccessoryEnabled(state), true);
    assert.equal(
        nativePlayerAccessoryEnabled({ ...state, collapsed: true }),
        false,
    );
    assert.equal(
        nativePlayerAccessoryEnabled({ ...state, inTabs: false }),
        false,
    );
    assert.equal(
        nativePlayerAccessoryEnabled({ ...state, hasTrack: false }),
        false,
    );
    assert.equal(
        nativePlayerAccessoryEnabled({ ...state, supported: false }),
        false,
    );
});

test("selection starts offscreen while the player stays at its bottom anchor", () => {
    const frame = selectionOverlayOffsets(0, 100, 393);
    assert.equal(Math.abs(frame.playerTranslateY), 0);
    assert.equal(frame.panelTranslateX, -393);
});

test("the final panel sits above the navbar and the player clears its top by one gap", () => {
    const anchor = 761;
    for (const height of [80, 100, 160]) {
        const frame = selectionOverlayOffsets(1, height, 393);
        const panelTop = anchor - height;
        const playerBottom = anchor + frame.playerTranslateY;
        assert.equal(panelTop - playerBottom, 8);
        assert.equal(Math.abs(frame.panelTranslateX), 0);
    }
});

test("slide and lift follow the same interrupted progress without a layout offset", () => {
    for (const progress of [0.25, 0.5, 0.75]) {
        const frame = selectionOverlayOffsets(progress, 100, 393);
        assert.equal(-frame.playerTranslateY / 108, progress);
        assert.equal(1 + frame.panelTranslateX / 393, progress);
    }
});

test("expanded playback stays anchored and puts selection above it", () => {
    const frame = selectionOverlayOffsets(1, 100, 393, 8, false);
    assert.equal(frame.playerTranslateY, 0);
    assert.equal(auxiliaryControlY(-56, 0, true), -56);
});

test("selection without playback stays in the bottom row", () => {
    const frame = selectionOverlayOffsets(1, 100, 393, 8, false, false);
    assert.equal(frame.playerTranslateY, 0);
    assert.equal(auxiliaryControlY(-56, 0, false), 0);
});

test("the panel follows the actual native accessory through docking", () => {
    const rowBottom = 761;
    for (const nativePlayerTop of [709, 729, 761]) {
        const y = selectionOffsetAboveNativePlayer(rowBottom, nativePlayerTop);
        assert.equal(nativePlayerTop - (rowBottom + y), 8);
    }
});

test("changing between expanded and circle stacks interpolates both vertical positions", () => {
    const frame = selectionOverlayOffsets(1, 100, 393, 8, 0.5);
    assert.equal(frame.playerTranslateY, -54);
    assert.equal(auxiliaryControlY(-56, 0.5, true), -28);
});

test("sort sits above expanded playback and returns beside the circle", () => {
    assert.equal(auxiliaryControlY(-60, 0, true), -60);
    assert.equal(auxiliaryControlY(-60, 0.5, true), -30);
    assert.equal(Math.abs(auxiliaryControlY(-60, 1, true)), 0);
    assert.equal(auxiliaryControlY(-60, 0, false), 0);
});

test("sort and selection follow the same native dock anchor", () => {
    for (const nativeTop of [709, 729, 761]) {
        const anchor = selectionOffsetAboveNativePlayer(761, nativeTop);
        assert.equal(761 + auxiliaryControlY(anchor, 0, true), nativeTop - 8);
    }
});

test("a drag moves the player edge the same distance as the finger", () => {
    const travel = 280;
    const progress = playerDragProgress(0, -70, travel);
    assert.equal(progress, 0.25);
    assert.equal(progress * travel, 70);
    assert.equal(playerDragProgress(1, 70, travel), 0.75);
});

test("grabbing a settling player preserves its current shape", () => {
    assert.equal(playerDragProgress(0.4, 0, 280), 0.4);
    assert.equal(playerDragProgress(0.4, -28, 280), 0.5);
});

test("the live drag stays within the available shape bounds", () => {
    assert.equal(playerDragProgress(0, 50, 280), 0);
    assert.equal(playerDragProgress(1, -50, 280), 1);
    assert.equal(Number.isFinite(playerDragProgress(0, -1, 0)), true);
});

test("slow releases settle to the nearer shape", () => {
    assert.equal(playerReleaseTarget(0.4, 0, 280), 0);
    assert.equal(playerReleaseTarget(0.6, 0, 280), 1);
});

test("release velocity can carry a flick or reverse the pending transition", () => {
    assert.equal(playerReleaseTarget(0.2, -800, 280), 1);
    assert.equal(playerReleaseTarget(0.8, 800, 280), 0);
    assert.equal(playerReleaseTarget(0.7, 800, 280), 0);
});

test("a swipe cannot become a tap when it ends or returns to its start", () => {
    assert.equal(playerTouchMoved(false, 1, 2), false);
    assert.equal(playerTouchMoved(false, -6, 0), true);
    assert.equal(playerTouchMoved(false, 12, 0), true);
    assert.equal(playerTouchMoved(false, 0, 12), true);
    assert.equal(playerTouchMoved(true, 0, 0), true);
});

test("bubble dragging keeps every direction inside the usable page", () => {
    assert.deepEqual(clampBubblePosition(180, 250, 20, 321, 60, 700), {
        x: 180,
        y: 250,
    });
    assert.deepEqual(clampBubblePosition(-100, -100, 20, 321, 60, 700), {
        x: 20,
        y: 60,
    });
    assert.deepEqual(clampBubblePosition(500, 900, 20, 321, 60, 700), {
        x: 321,
        y: 700,
    });
});

test("home capture uses one radius of circular distance, including its edge", () => {
    assert.equal(bubbleNearHome(20, 700, 20, 700, 26), true);
    assert.equal(bubbleNearHome(46, 700, 20, 700, 26), true);
    assert.equal(bubbleNearHome(20, 674, 20, 700, 26), true);
    assert.equal(bubbleNearHome(38, 682, 20, 700, 26), true);
    assert.equal(bubbleNearHome(40, 680, 20, 700, 26), false);
    assert.equal(bubbleNearHome(46.1, 700, 20, 700, 26), false);
});

test("temporary chrome suppression never falls back to a local action button", () => {
    assert.equal(bottomActionPlacement(true, true, true), "shared");
    assert.equal(bottomActionPlacement(false, true, true), "hidden");
    assert.equal(bottomActionPlacement(false, false, true), "local");
    assert.equal(bottomActionPlacement(true, false, false), "hidden");
});

test("player host remains mounted beneath a sheet and leaves when a detail covers it", () => {
    const routes = [
        { key: "tabs", name: "(tabs)" },
        { key: "tag", name: "tag/[tagId]" },
        { key: "sheet", name: "player" },
    ];
    assert.equal(playerHostIsActive(false, "tag", routes), true);
    assert.equal(playerHostIsActive(false, "tabs", routes), false);
    assert.equal(
        playerHostIsActive(false, "tag", [
            ...routes,
            { key: "appearance", name: "appearance" },
        ]),
        true,
    );
    assert.equal(playerHostIsActive(false, "tabs", routes.slice(0, 2)), false);
    assert.equal(playerHostIsActive(true, "tag", routes.slice(0, 2)), true);
    assert.equal(
        playerHostIsActive(false, "tabs", [routes[0], routes[2]]),
        true,
    );
});
