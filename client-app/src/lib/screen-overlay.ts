import { useIsFocused, useNavigationState } from "expo-router/react-navigation";
import { useRootNavigationState, useSegments, useRoute } from "expo-router";
import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { Keyboard, Platform, type View } from "react-native";
import {
    useSafeAreaFrame,
    useSafeAreaInsets,
} from "react-native-safe-area-context";

import { BottomSelectionOverlayProvider } from "./bottom-selection-overlay";
import {
    PlayerPresentationProvider,
    usePlayerPresentation,
    useNativePlayerHandoff,
} from "./player-presentation";
import { usePlaybackTrackState } from "./playback";
import {
    calculateScreenOverlayInsets,
    bottomActionPlacement,
    playerHostIsActive,
    nativePlayerAccessoryEnabled,
    OVERLAY_GAP,
    PLAYER_CONTROL_SIZE,
    PLAYER_SIDE_INSET,
    rightOffsetOverSearch,
} from "./screen-overlay-geometry";
export {
    COMPACT_PLAYER_HEIGHT,
    FLOATING_ACTION_SIZE,
} from "./screen-overlay-geometry";

/** iOS 26 and up: the floating glass tab bar, with Search as its own circle. */
export const GLASS_TAB_BAR =
    Platform.OS === "ios" &&
    Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * Where a screen's own bottom action floats from the right: centered over
 * Search on the glass tab bar, else at the player's side inset.
 */
export const BOTTOM_ACTION_RIGHT_OFFSET = GLASS_TAB_BAR
    ? rightOffsetOverSearch(PLAYER_CONTROL_SIZE)
    : PLAYER_SIDE_INSET;

const NATIVE_TAB_BAR_HEIGHT = Platform.select({
    ios: 49,
    android: 80,
    default: 60,
}) as number;

/**
 * Root segments presented as a sheet over the tabs rather than as a screen of
 * their own. A sheet is a native surface over the whole app. The bars stay
 * mounted under it so they are ready as dismissal begins. Appearance stacks
 * from Account and keeps that same modal context.
 */
const SHEET_SEGMENTS = new Set([
    "account",
    "assistant",
    "appearance",
    "player",
    "library-categories",
    "add-to-playlist",
]);

export type BottomRowAction = {
    expanded: boolean;
    icon: "add" | "funnel" | "funnel-outline";
    accessibilityLabel: string;
    onPress: () => void;
};

type BottomBarVisibility = {
    rowAction: BottomRowAction | null;
    setRowAction: (token: string, action: BottomRowAction | null) => void;
    suppressed: boolean;
    setSuppressed: (token: string, suppressed: boolean) => void;
};

const NativePlayerAccessoryContext = createContext(false);

const BottomBarVisibilityContext = createContext<BottomBarVisibility | null>(
    null,
);

/**
 * Whether the software keyboard is up.
 *
 * iOS gets the `Will` events so the bars start leaving on the same frame the
 * keyboard starts arriving. Android only fires the `Did` pair.
 */
function useKeyboardVisible() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const ios = Platform.OS === "ios";
        const shown = Keyboard.addListener(
            ios ? "keyboardWillShow" : "keyboardDidShow",
            () => setVisible(true),
        );
        const hidden = Keyboard.addListener(
            ios ? "keyboardWillHide" : "keyboardDidHide",
            () => setVisible(false),
        );
        return () => {
            shown.remove();
            hidden.remove();
        };
    }, []);

    return visible;
}

/**
 * Shares visibility exceptions for the two bottom bars.
 *
 * A raised keyboard is one for every screen at once, so it is handled here
 * rather than by a token: the bars would otherwise sit on top of the keyboard
 * or shove the focused field around. Everything else, such as focused search,
 * registers its own token.
 */
export function BottomBarVisibilityProvider({
    children,
}: {
    children: ReactNode;
}) {
    const keyboardVisible = useKeyboardVisible();
    const [rowActions, setRowActions] = useState<
        ReadonlyMap<string, BottomRowAction>
    >(() => new Map());
    const setRowAction = useCallback(
        (token: string, action: BottomRowAction | null) => {
            setRowActions((current) => {
                if ((current.get(token) ?? null) === action) return current;
                const next = new Map(current);
                if (action) next.set(token, action);
                else next.delete(token);
                return next;
            });
        },
        [],
    );
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
        () => ({
            rowAction: Array.from(rowActions.values()).at(-1) ?? null,
            setRowAction,
            suppressed: keyboardVisible || tokens.size > 0,
            setSuppressed,
        }),
        [keyboardVisible, setSuppressed, tokens, rowActions, setRowAction],
    );

    return createElement(
        BottomBarVisibilityContext.Provider,
        { value },
        createElement(
            BottomSelectionOverlayProvider,
            null,
            createElement(
                PlayerPresentationProvider,
                null,
                createElement(NativePlayerAccessoryProvider, null, children),
            ),
        ),
    );
}

/** The source owns its sheet; the shared host owns placement and visibility. */
export function useBottomRowActionButton(action: BottomRowAction) {
    const focused = useIsFocused();
    const { bottomControlRowAvailable } = useScreenOverlayInsets();
    const hidden = useBottomBarsHidden();
    const placement = bottomActionPlacement(
        bottomControlRowAvailable,
        hidden,
        focused,
    );
    const setAction = useContext(BottomBarVisibilityContext)?.setRowAction;
    const token = useId();
    useLayoutEffect(() => {
        setAction?.(token, placement === "shared" ? action : null);
        return () => setAction?.(token, null);
    }, [setAction, token, action, placement]);
    return placement === "local";
}

export function useBottomRowAction() {
    return useContext(BottomBarVisibilityContext)?.rowAction ?? null;
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
 * Whether this screen was pushed onto its stack, rather than being the stack's
 * first screen. A pushed screen has an open transition to wait for.
 */
export function useIsPushedScreen() {
    const route = useRoute();
    return useNavigationState((state) => state.routes[0]?.key !== route.key);
}

/** Keep foreground chrome alive underneath native sheets during dismissal. */
export function usePlayerHostActive() {
    const focused = useIsFocused();
    const route = useRoute();
    const state = useRootNavigationState();
    return playerHostIsActive(
        focused,
        route.key,
        state?.routes ?? [],
        state?.index,
    );
}

/** Expanded playback docks while auxiliary controls float above it. */
function useWantsNativePlayerAccessory() {
    const { activeTrack, isPlayerCollapsed } = usePlaybackTrackState();
    const rootSegment = useBaseRouteSegment();
    const insideSheet = useContext(InsideSheetContext);
    return nativePlayerAccessoryEnabled({
        supported: GLASS_TAB_BAR,
        inTabs: !insideSheet && rootSegment === "(tabs)",
        hasTrack: activeTrack != null,
        collapsed: isPlayerCollapsed,
    });
}

/** The floating expansion finishes before UIKit inserts the native accessory. */
function NativePlayerAccessoryProvider({ children }: { children: ReactNode }) {
    const wanted = useWantsNativePlayerAccessory();
    const { inFlight, nativePresented, entrancePending } =
        usePlayerPresentation();
    const ready = useNativePlayerHandoff(wanted, inFlight);
    // Completion gates insertion, never an accessory that already owns a drag.
    const enabled = wanted && !entrancePending && (ready || nativePresented);
    return createElement(
        NativePlayerAccessoryContext.Provider,
        { value: enabled },
        children,
    );
}

export function useNativePlayerAccessoryEnabled() {
    return useContext(NativePlayerAccessoryContext);
}

/**
 * Extra insets for app-owned overlays. Native tabs inset scrolling content on
 * their own; absolute controls still need a conservative chrome footprint.
 */
export function useScreenOverlayInsets() {
    const { activeTrack } = usePlaybackTrackState();
    const insets = useSafeAreaInsets();
    const rootSegment = useBaseRouteSegment();
    const insideSheet = useContext(InsideSheetContext);
    const hidden = useBottomBarsHidden();
    const inNativeTabs = !insideSheet && rootSegment === "(tabs)";
    const bottomBarsVisible = inNativeTabs && !hidden;
    const bottomControlRowAvailable = inNativeTabs;
    const bottomControlRowVisible = !hidden && bottomControlRowAvailable;
    const compactPlayerVisible = activeTrack != null && bottomControlRowVisible;
    const nativePlayerAccessory =
        useNativePlayerAccessoryEnabled() && inNativeTabs;

    return {
        bottomControlRowAvailable,
        bottomControlRowVisible,
        nativePlayerAccessory,
        ...calculateScreenOverlayInsets({
            safeAreaBottom: insets.bottom,
            nativeTabBarHeight: NATIVE_TAB_BAR_HEIGHT,
            bottomBarsVisible,
            compactPlayerVisible,
            nativePlayerAccessory,
            tabContentAboveTabBar: inNativeTabs && Platform.OS === "android",
        }),
    };
}

/**
 * `floatingActionBottom` for an absolute control, checked against where its
 * container really ends. Android usually ends a tab's screen at the tab bar,
 * which the inset assumes, but a screen pushed inside a tab's stack, like
 * Library Songs, can run on under the bar, and a control placed for the first
 * kind sits hidden behind the bar, or behind the player once one plays.
 *
 * While `measuring`, put `measureRef` and `onMeasureLayout` on a view that
 * fills the control's container. When that
 * container reaches the bottom of the window, the control clears the tab bar
 * and the player itself. Anywhere else this is `floatingActionBottom` as is.
 */
export function useMeasuredFloatingActionBottom() {
    const insets = useScreenOverlayInsets();
    const frame = useSafeAreaFrame();
    const ref = useRef<View>(null);
    const [reachesBottom, setReachesBottom] = useState(false);
    const measuring = Platform.OS === "android" && insets.bottomBarsVisible;
    const onLayout = useCallback(() => {
        ref.current?.measureInWindow((_x, y, _width, height) => {
            const gap = frame.y + frame.height - (y + height);
            setReachesBottom(gap < NATIVE_TAB_BAR_HEIGHT / 2);
        });
    }, [frame.height, frame.y]);

    return {
        bottom:
            measuring && reachesBottom
                ? insets.playerBottomInset + OVERLAY_GAP
                : insets.floatingActionBottom,
        /** Whether to render the measuring view at all. */
        measuring,
        measureRef: ref,
        onMeasureLayout: onLayout,
    };
}
