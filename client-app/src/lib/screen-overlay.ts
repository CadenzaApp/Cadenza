import { useRootNavigationState, useSegments } from "expo-router";
import { createContext, useContext } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlayback } from "./playback";

/** The floating tab bar pill, excluding the gap below it. */
export const TAB_BAR_HEIGHT = 60;
/**
 * Side gutter shared by both floating bars, and the gap the tab bar leaves
 * above the home indicator. Both bars apply it as `marginHorizontal`, so they
 * are always exactly as wide as each other.
 */
export const TAB_BAR_MARGIN = 12;
export const COMPACT_PLAYER_HEIGHT = 64;
export const FLOATING_ACTION_SIZE = 56;

const OVERLAY_GAP = 12;
/**
 * Gap between the tab bar and the compact player. Smaller than `OVERLAY_GAP`
 * because `bottomBarInset` already carries `TAB_BAR_MARGIN` above the bar, so
 * the two add up to what you actually see between the pills.
 */
const COMPACT_PLAYER_GAP = 7;

/** Root segments presented as a sheet rather than as a screen of their own. */
const SHEET_SEGMENTS = new Set([
    "account",
    "player",
    "library-categories",
    "category",
    "collection",
    "tag",
    "artist",
    "add-to-playlist",
]);

/**
 * True for content rendered inside a presented sheet. A sheet is its own
 * surface: the tab bar and the compact player are behind it, not over it, so
 * its content owes them nothing. `SheetScreen` is what sets this.
 */
export const InsideSheetContext = createContext(false);

/**
 * The root segment of the screen a user is actually looking at. A sheet is
 * presented over that screen rather than replacing it, so it must not change
 * how anything underneath is laid out.
 */
export function useBaseRouteSegment() {
    const segments = useSegments();
    const navigationState = useRootNavigationState();
    const rootSegment = segments[0];

    if (rootSegment === undefined || !SHEET_SEGMENTS.has(rootSegment)) {
        return rootSegment;
    }

    // The sheet is the top of the root stack, so the screen it covers is the
    // entry directly beneath it. Route names are paths, segments are not.
    const routes = navigationState?.routes ?? [];
    return routes[routes.length - 2]?.name.split("/")[0];
}

/**
 * Insets expressed in the coordinate space of the active screen content.
 *
 * Both bottom bars float over the content rather than sitting in the layout, so
 * nothing reserves space for them automatically. Every scrolling surface owes
 * itself the padding this returns, or its last row hides under a bar.
 */
export function useScreenOverlayInsets() {
    const { activeTrack } = usePlayback();
    const insets = useSafeAreaInsets();
    const rootSegment = useBaseRouteSegment();
    const insideSheet = useContext(InsideSheetContext);
    const isTabScreen = !insideSheet && rootSegment === "(tabs)";
    const compactPlayerVisible = activeTrack != null && isTabScreen;

    // What the bottom of the surface is already spending. Under the tabs that
    // is the floating pill and the safe area it clears. Inside a sheet it is
    // only the safe area, because the bars are behind the sheet.
    const bottomBarInset = isTabScreen
        ? insets.bottom + TAB_BAR_MARGIN + TAB_BAR_HEIGHT
        : insideSheet
          ? insets.bottom
          : 0;

    const compactPlayerBottom = bottomBarInset + COMPACT_PLAYER_GAP;
    const playerBottomInset = compactPlayerVisible
        ? compactPlayerBottom + COMPACT_PLAYER_HEIGHT
        : bottomBarInset;
    const floatingActionBottom = playerBottomInset + OVERLAY_GAP;

    return {
        compactPlayerVisible,
        /** Where the compact player pins itself. */
        compactPlayerBottom,
        playerBottomInset,
        floatingActionBottom,
        /** Bottom padding for a scrolling surface with no floating button. */
        contentBottomInset: playerBottomInset + OVERLAY_GAP,
        /** Bottom padding for a list that also sits under a floating button. */
        listBottomInset: Math.max(
            40,
            floatingActionBottom + FLOATING_ACTION_SIZE + OVERLAY_GAP,
        ),
    };
}
