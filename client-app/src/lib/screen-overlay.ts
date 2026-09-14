import { useRootNavigationState, useSegments } from "expo-router";
import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useId,
    useLayoutEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
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
/**
 * Inset of anything drawn inside the tab bar pill: the selection bubble, and
 * the mini player once it docks. Both read it from here so they line up.
 */
export const TAB_BAR_ITEM_INSET = 3;
export const DOCKED_PLAYER_HEIGHT = TAB_BAR_HEIGHT - TAB_BAR_ITEM_INSET * 2;
export const FLOATING_ACTION_SIZE = 56;

const OVERLAY_GAP = 12;
/**
 * Gap between the tab bar and the compact player. `bottomBarInset` already
 * carries `TAB_BAR_MARGIN` above the bar, so this plus that is the 15pt you
 * actually see between the two pills.
 */
const COMPACT_PLAYER_GAP = 3;

/**
 * Root segments presented as a sheet rather than as a screen of their own. A
 * sheet is a native surface over the whole app, so both bottom bars hide while
 * it is open. Account and Player are screens you finish with before going
 * anywhere. Appearance stacks from Account and keeps that same modal context.
 */
const SHEET_SEGMENTS = new Set(["account", "appearance", "player"]);

/**
 * Root segments pushed as a full screen that the bars float over, exactly as
 * they float over a tab. Drilling into an album or an artist keeps the bar you
 * navigate with, which is the whole reason these are not sheets.
 */
const PUSHED_DETAIL_SEGMENTS = new Set([
    "artist",
    "collection",
    "category",
    "tag",
    "library-categories",
    "add-to-playlist",
]);

/** Routes that never have the app's navigation bars underneath them. */
const BARLESS_BASE_SEGMENTS = new Set(["(splashscreen)", "auth"]);

type BottomBarVisibility = {
    suppressed: boolean;
    setSuppressed: (token: string, suppressed: boolean) => void;
};

const BottomBarVisibilityContext = createContext<BottomBarVisibility | null>(
    null,
);

/** Shares temporary visibility exceptions, such as focused search. */
export function BottomBarVisibilityProvider({
    children,
}: {
    children: ReactNode;
}) {
    const [tokens, setTokens] = useState<ReadonlySet<string>>(() => new Set());
    const setSuppressed = useCallback((token: string, suppressed: boolean) => {
        setTokens((current) => {
            if (current.has(token) === suppressed) return current;

            const next = new Set(current);
            if (suppressed) next.add(token);
            else next.delete(token);
            return next;
        });
    }, []);
    const value = useMemo(
        () => ({ suppressed: tokens.size > 0, setSuppressed }),
        [setSuppressed, tokens],
    );

    return createElement(
        BottomBarVisibilityContext.Provider,
        { value },
        children,
    );
}

/** Hides both bottom bars while this caller's condition is true. */
export function useSuppressBottomBars(suppressed: boolean) {
    const visibility = useContext(BottomBarVisibilityContext);
    const token = useId();
    const setSuppressed = visibility?.setSuppressed;
    useLayoutEffect(() => {
        if (!setSuppressed) return;
        setSuppressed(token, suppressed);
        return () => setSuppressed(token, false);
    }, [setSuppressed, suppressed, token]);

    if (!visibility) {
        throw new Error(
            "useSuppressBottomBars must run inside BottomBarVisibilityProvider",
        );
    }
}

/**
 * True for content rendered inside a presented sheet. A sheet is its own
 * surface: the tab bar and the compact player do not render over it, so its
 * content owes them nothing. `DetailScreen` sets it for a sheet presentation.
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
 * Whether the screen on top is one of the pushed detail routes.
 *
 * Those are the ones with no native dismiss of their own: a sheet drags down
 * because iOS makes it, and a tab has nowhere to go. Only these need the pull
 * at the top wired up by hand.
 */
export function useIsPushedDetailScreen() {
    const segments = useSegments();
    const rootSegment: string | undefined = segments[0];
    const insideSheet = useContext(InsideSheetContext);
    return (
        !insideSheet &&
        rootSegment !== undefined &&
        PUSHED_DETAIL_SEGMENTS.has(rootSegment)
    );
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
    const segments = useSegments();
    const rootSegment = useBaseRouteSegment();
    const insideSheet = useContext(InsideSheetContext);
    const visibility = useContext(BottomBarVisibilityContext);
    const topSegment = segments[0];
    // Bars are the default for every authenticated app route. New detail
    // screens inherit them without another allowlist entry.
    const hasBars =
        !insideSheet &&
        rootSegment !== undefined &&
        !BARLESS_BASE_SEGMENTS.has(rootSegment);
    // Native sheets own the whole visible surface. Focused search is the one
    // in-place screen state that suppresses the bars.
    const coveredBySheet =
        topSegment !== undefined && SHEET_SEGMENTS.has(topSegment);
    const bottomBarsVisible =
        hasBars && !coveredBySheet && !(visibility?.suppressed ?? false);
    const compactPlayerVisible = bottomBarsVisible && activeTrack != null;

    // What the bottom of the surface is already spending. Where the bars are,
    // that is the floating pill and the safe area it clears. Inside a sheet it
    // is only the safe area, because the bars are behind the sheet.
    const bottomBarInset = hasBars
        ? insets.bottom + TAB_BAR_MARGIN + TAB_BAR_HEIGHT
        : insideSheet
          ? insets.bottom
          : 0;

    const compactPlayerBottom = bottomBarInset + COMPACT_PLAYER_GAP;
    // Where the player sits once it docks: inside the bar rather than above it.
    const dockedPlayerBottom = insets.bottom + TAB_BAR_ITEM_INSET;
    const playerBottomInset = compactPlayerVisible
        ? compactPlayerBottom + COMPACT_PLAYER_HEIGHT
        : bottomBarInset;
    const floatingActionBottom = playerBottomInset + OVERLAY_GAP;

    return {
        /** Whether the tab bar renders. `TabBarHost` is the one caller. */
        bottomBarsVisible,
        /** Where the tab bar pins itself. The player measures its dock off it. */
        bottomBarBottom: insets.bottom,
        compactPlayerVisible,
        /** Whether there is a tab bar under the player to dock into. */
        playerCanDock: bottomBarsVisible,
        /** Where the compact player pins itself while it floats. */
        compactPlayerBottom,
        /** Where it pins itself once it is docked inside the tab bar. */
        dockedPlayerBottom,
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
