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
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePlayback } from "./playback";
import { calculateScreenOverlayInsets } from "./screen-overlay-geometry";
export {
    COMPACT_PLAYER_HEIGHT,
    FLOATING_ACTION_SIZE,
} from "./screen-overlay-geometry";

const NATIVE_TAB_BAR_HEIGHT = Platform.select({
    ios: 49,
    android: 80,
    default: 60,
}) as number;

/** Whether UITabBarController can host the native player accessory. */
export function supportsNativeTabBottomAccessory() {
    return (
        Platform.OS === "ios" &&
        Number.parseInt(String(Platform.Version), 10) >= 26
    );
}

/**
 * Root segments presented as a sheet rather than as a screen of their own. A
 * sheet is a native surface over the whole app. The bars stay mounted under
 * it so they are ready as dismissal begins. Appearance stacks from Account and
 * keeps that same modal context.
 */
const SHEET_SEGMENTS = new Set(["account", "appearance", "player"]);

/**
 * Root segments pushed as a full screen with the custom pull-to-close gesture.
 */
const PUSHED_DETAIL_SEGMENTS = new Set([
    "artist",
    "collection",
    "category",
    "tag",
    "library-categories",
    "add-to-playlist",
]);

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

/** Whether an in-place state, such as focused Search, hides the bottom bars. */
export function useBottomBarsHidden() {
    const visibility = useContext(BottomBarVisibilityContext);

    if (!visibility) {
        throw new Error(
            "useBottomBarsHidden must run inside BottomBarVisibilityProvider",
        );
    }

    // Native sheets already cover the tab navigator. Keeping it mounted below
    // them makes it visible on the first frame of the dismissal transition.
    return visibility.suppressed;
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

/** Root detail routes over which the app-level compact player is visible. */
export function useShowsPushedPlayerOverlay() {
    const segments = useSegments();
    const rootSegment: string | undefined = segments[0];
    const insideSheet = useContext(InsideSheetContext);
    return (
        !insideSheet &&
        (rootSegment === "artist" || rootSegment === "collection")
    );
}

/**
 * Extra insets for app-owned overlays. Native tabs inset scrolling content on
 * their own; absolute controls still need a conservative chrome footprint.
 */
export function useScreenOverlayInsets() {
    const { activeTrack } = usePlayback();
    const insets = useSafeAreaInsets();
    const rootSegment = useBaseRouteSegment();
    const insideSheet = useContext(InsideSheetContext);
    const hidden = useBottomBarsHidden();
    const showsPushedPlayerOverlay = useShowsPushedPlayerOverlay();
    const inNativeTabs = !insideSheet && rootSegment === "(tabs)";
    const bottomBarsVisible = inNativeTabs && !hidden;
    const compactPlayerVisible =
        !hidden &&
        activeTrack != null &&
        (bottomBarsVisible || showsPushedPlayerOverlay);
    const nativePlayerAccessory = supportsNativeTabBottomAccessory();

    return calculateScreenOverlayInsets({
        safeAreaBottom: insets.bottom,
        nativeTabBarHeight: NATIVE_TAB_BAR_HEIGHT,
        bottomBarsVisible,
        compactPlayerVisible,
        nativePlayerAccessory,
    });
}
