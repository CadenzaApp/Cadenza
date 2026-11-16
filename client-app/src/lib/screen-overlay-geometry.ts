/** Shared spring style for bottom controls, including native docking target changes. */
export const BOTTOM_CONTROL_SPRING = {
    damping: 32,
    stiffness: 520,
    mass: 0.8,
} as const;

export const COMPACT_PLAYER_HEIGHT = 48;
export const FLOATING_ACTION_SIZE = 56;
export const PLAYER_CONTROL_SIZE = 52;
export const OVERLAY_GAP = 12;
export const PLAYER_ROW_GAP = 8;
export const PLAYER_SIDE_INSET = 20;

/**
 * iOS 26's floating tab bar is 62pt tall, so its Search circle is 62pt
 * across, and it sits 21pt in from the screen's sides. UIKit does not expose
 * the frame, so these are the measured values fabbar ships.
 */
export const GLASS_TAB_BAR_HEIGHT = 62;
export const GLASS_TAB_BAR_SIDE_INSET = 21;
/** The Search circle's center, measured from the screen's right edge. */
export const SEARCH_TAB_CENTER_FROM_RIGHT =
    GLASS_TAB_BAR_SIDE_INSET + GLASS_TAB_BAR_HEIGHT / 2;

/**
 * How far to shift the bottom row action from its resting spot, centered
 * `PLAYER_SIDE_INSET` in from the right, so it centers over Search. Negative
 * is left.
 */
export const SEARCH_DOCK_X =
    PLAYER_SIDE_INSET + PLAYER_CONTROL_SIZE / 2 - SEARCH_TAB_CENTER_FROM_RIGHT;

/** The right offset that centers a floating control of `size` over Search. */
export function rightOffsetOverSearch(size: number) {
    return SEARCH_TAB_CENTER_FROM_RIGHT - size / 2;
}

/** UIKit owns scroll docking only for the expanded player on primary tabs. */
export function nativePlayerAccessoryEnabled({
    supported,
    inTabs,
    hasTrack,
    collapsed,
}: {
    supported: boolean;
    inTabs: boolean;
    hasTrack: boolean;
    collapsed: boolean;
}) {
    return supported && inTabs && hasTrack && !collapsed;
}

export function calculateScreenOverlayInsets({
    safeAreaBottom,
    nativeTabBarHeight,
    bottomBarsVisible,
    compactPlayerVisible,
    nativePlayerAccessory,
    tabContentAboveTabBar,
}: {
    safeAreaBottom: number;
    nativeTabBarHeight: number;
    bottomBarsVisible: boolean;
    compactPlayerVisible: boolean;
    nativePlayerAccessory: boolean;
    /**
     * Android wraps each native tab screen in a bottom safe area as tall as
     * the tab bar, so the screen already ends at the tab bar's top edge.
     */
    tabContentAboveTabBar: boolean;
}) {
    const playerBottomInset = bottomBarsVisible
        ? safeAreaBottom +
          nativeTabBarHeight +
          (compactPlayerVisible ? PLAYER_ROW_GAP + PLAYER_CONTROL_SIZE : 0)
        : compactPlayerVisible
          ? safeAreaBottom + PLAYER_ROW_GAP + PLAYER_CONTROL_SIZE
          : safeAreaBottom;
    // UIKit already shortens a native-tab screen's usable overlay area above
    // its bottom accessory. Adding the tab and player heights again puts an
    // absolute bubble roughly a second player-height too high.
    // On Android the tab screen already sits above the tab bar and the system
    // inset, so only the floating player is left to clear.
    const floatingActionBottom = tabContentAboveTabBar
        ? (compactPlayerVisible ? PLAYER_ROW_GAP + PLAYER_CONTROL_SIZE : 0) +
          OVERLAY_GAP
        : bottomBarsVisible && nativePlayerAccessory
          ? safeAreaBottom + OVERLAY_GAP
          : playerBottomInset + OVERLAY_GAP;
    // For a tab screen the native tab bar floats over, like Cadenza's query
    // workspace: clear the bar itself, plus the player where it floats over
    // the screen too. On iOS 26 UIKit already takes the accessory's space out
    // of the screen, the same allowance the query palette makes.
    const floatingOverTabBarBottom =
        (bottomBarsVisible
            ? safeAreaBottom +
              nativeTabBarHeight +
              (compactPlayerVisible && !nativePlayerAccessory
                  ? PLAYER_ROW_GAP + PLAYER_CONTROL_SIZE
                  : 0)
            : playerBottomInset) + OVERLAY_GAP;
    // The tab screens turn off UIKit's automatic content insets (see
    // `(tabs)/_layout.tsx`), so on iOS a scroller clears the tab bar and the
    // player itself. Android's tab screen already ends above its tab bar.
    const contentBottomInset = bottomBarsVisible
        ? tabContentAboveTabBar
            ? compactPlayerVisible && !nativePlayerAccessory
                ? PLAYER_CONTROL_SIZE + PLAYER_ROW_GAP + OVERLAY_GAP
                : OVERLAY_GAP
            : playerBottomInset + OVERLAY_GAP
        : compactPlayerVisible
          ? PLAYER_CONTROL_SIZE + PLAYER_ROW_GAP + safeAreaBottom + OVERLAY_GAP
          : Math.max(40, safeAreaBottom + OVERLAY_GAP);

    return {
        bottomBarsVisible,
        compactPlayerVisible,
        playerBottomInset,
        floatingActionBottom,
        floatingOverTabBarBottom,
        contentBottomInset,
        listBottomInset: Math.max(
            40,
            contentBottomInset + FLOATING_ACTION_SIZE + OVERLAY_GAP,
        ),
    };
}

/** Both transforms use the same progress and a fixed bottom anchor. */
export function selectionOverlayOffsets(
    progress: number,
    panelHeight: number,
    windowWidth: number,
    gap = 8,
    collapsed: boolean | number = true,
    hasPlayer = true,
) {
    "worklet";
    const circle =
        typeof collapsed === "boolean" ? Number(collapsed) : collapsed;
    return {
        playerTranslateY: hasPlayer
            ? 0 - (panelHeight + gap) * progress * circle
            : 0,
        panelTranslateX: -windowWidth * (1 - progress),
    };
}

/** Keep the panel above the actual accessory frame as UIKit moves it inline. */
export function selectionOffsetAboveNativePlayer(
    rowBottom: number,
    playerTop: number,
    gap = 8,
) {
    "worklet";
    return playerTop - gap - rowBottom;
}

/** Sort and selection share the same animated anchor above expanded playback. */
export function auxiliaryControlY(
    anchorY: number,
    circleProgress: number,
    hasPlayer: boolean,
) {
    "worklet";
    return hasPlayer ? anchorY * (1 - circleProgress) : 0;
}

/** Translate finger movement into the current shape, without restarting at an endpoint. */
export function playerDragProgress(
    start: number,
    translationX: number,
    travel: number,
) {
    "worklet";
    return Math.min(1, Math.max(0, start - translationX / Math.max(1, travel)));
}

/** Project the release briefly forward so a flick carries into the settling spring. */
export function playerReleaseTarget(
    progress: number,
    velocityX: number,
    travel: number,
): 0 | 1 {
    "worklet";
    const projected = progress - (velocityX / Math.max(1, travel)) * 0.16;
    return projected > 0.5 ? 1 : 0;
}

/** Once a touch becomes a drag, its release cannot activate a button. */
export function playerTouchMoved(
    suppressed: boolean,
    deltaX: number,
    deltaY: number,
) {
    "worklet";
    return suppressed || Math.hypot(deltaX, deltaY) >= 6;
}

/** Keep a freely placed bubble inside the usable page, above the navigation bar. */
export function clampBubblePosition(
    x: number,
    y: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
) {
    "worklet";
    return {
        x: Math.max(minX, Math.min(Math.max(minX, maxX), x)),
        y: Math.max(minY, Math.min(Math.max(minY, maxY), y)),
    };
}

/** Home capture is a circle, measured between bubble centers (or equal-sized origins). */
export function bubbleNearHome(
    x: number,
    y: number,
    homeX: number,
    homeY: number,
    radius: number,
) {
    "worklet";
    return Math.hypot(x - homeX, y - homeY) <= radius;
}

/** Supported routes keep their shared host even while temporarily hidden. */
export function bottomActionPlacement(
    available: boolean,
    hidden: boolean,
    focused: boolean,
) {
    return !focused
        ? "hidden"
        : available
          ? "shared"
          : hidden
            ? "hidden"
            : "local";
}

/** Preserve the underlying host through sheet presentation, not pushed navigation. */
export function playerHostIsActive(
    focused: boolean,
    key: string,
    routes: readonly { key: string; name: string }[],
    index = routes.length - 1,
) {
    if (focused) return true;
    const sheets = ["player", "account", "appearance"];
    if (!sheets.includes(routes[index]?.name.split("/")[0])) return false;
    let underlying = index;
    while (
        underlying >= 0 &&
        sheets.includes(routes[underlying].name.split("/")[0])
    )
        underlying--;
    return routes[underlying]?.key === key;
}
