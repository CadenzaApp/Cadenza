export const COMPACT_PLAYER_HEIGHT = 64;
export const FLOATING_ACTION_SIZE = 56;
const OVERLAY_GAP = 12;
const ACCESSORY_GAP = 8;

export function calculateScreenOverlayInsets({
    safeAreaBottom,
    nativeTabBarHeight,
    bottomBarsVisible,
    compactPlayerVisible,
    nativePlayerAccessory,
}: {
    safeAreaBottom: number;
    nativeTabBarHeight: number;
    bottomBarsVisible: boolean;
    compactPlayerVisible: boolean;
    nativePlayerAccessory: boolean;
}) {
    const playerBottomInset = bottomBarsVisible
        ? safeAreaBottom +
          nativeTabBarHeight +
          (compactPlayerVisible ? ACCESSORY_GAP + COMPACT_PLAYER_HEIGHT : 0)
        : compactPlayerVisible
          ? safeAreaBottom + ACCESSORY_GAP + COMPACT_PLAYER_HEIGHT
          : safeAreaBottom;
    // UIKit already shortens a native-tab screen's usable overlay area above
    // its bottom accessory. Adding the tab and player heights again puts an
    // absolute bubble roughly a second player-height too high.
    const floatingActionBottom =
        bottomBarsVisible && nativePlayerAccessory
            ? safeAreaBottom + OVERLAY_GAP
            : playerBottomInset + OVERLAY_GAP;
    const contentBottomInset = bottomBarsVisible
        ? compactPlayerVisible && !nativePlayerAccessory
            ? COMPACT_PLAYER_HEIGHT + ACCESSORY_GAP + OVERLAY_GAP
            : OVERLAY_GAP
        : compactPlayerVisible
          ? COMPACT_PLAYER_HEIGHT + ACCESSORY_GAP + safeAreaBottom + OVERLAY_GAP
          : Math.max(40, safeAreaBottom + OVERLAY_GAP);

    return {
        bottomBarsVisible,
        compactPlayerVisible,
        playerBottomInset,
        floatingActionBottom,
        contentBottomInset,
        listBottomInset: Math.max(
            40,
            contentBottomInset + FLOATING_ACTION_SIZE + OVERLAY_GAP,
        ),
    };
}
