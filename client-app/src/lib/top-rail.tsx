import { NavigationRouteContext } from "expo-router/react-navigation";
import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { Platform } from "react-native";
import { makeMutable, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RAIL_CONTENT_GAP, TOP_RAIL_HEIGHT } from "./top-rail-geometry";

/**
 * Shared state between a tab stack's `TopRail` headers and the screens under
 * them.
 *
 * A route's rail either floats or is pinned. A floating rail sits over the
 * page, whose scroller pads its content's top by the rail's height plus
 * `RAIL_CONTENT_GAP`, the same on every page. Scrolling
 * down fades it away and the page runs up under the status bar; back at the
 * top it fades in over the room the inset kept for it. Nothing in the page
 * moves either way.
 *
 * A pinned rail sits above the screen in its column and never hides. It is for
 * a screen with a fixed bar above its scroller, which a floating rail would
 * cover, and for Android.
 */
export type RailReveal = {
    /** Animated, 1 shown through 0 hidden. What the rail draws from. */
    progress: SharedValue<number>;
    /** Where `progress` is headed, 1 or 0. Shared, so every scroller on the
     * screen agrees on it. */
    target: SharedValue<number>;
};

type TopRailState = {
    revealFor: (routeKey: string) => RailReveal;
    isPinned: (routeName: string) => boolean;
    /** The floating rail's measured height, null until it has laid out. */
    railHeight: number | null;
    setRailHeight: (height: number) => void;
};

const TopRailContext = createContext<TopRailState | null>(null);

type ProviderProps = {
    /** Route names in the stack whose rail is pinned rather than floating. */
    pinned?: readonly string[];
    children: ReactNode;
};

/** Wraps a tab's stack, so its rails and screens can find each other. */
export function TopRailProvider({ pinned, children }: ProviderProps) {
    // a cache filled lazily as rails and screens ask, never read for rendering
    const [reveals] = useState(() => new Map<string, RailReveal>());

    const revealFor = useCallback(
        (routeKey: string) => {
            let reveal = reveals.get(routeKey);
            if (!reveal) {
                reveal = { progress: makeMutable(1), target: makeMutable(1) };
                reveals.set(routeKey, reveal);
            }
            return reveal;
        },
        [reveals],
    );

    // joined, so a caller passing a fresh array each render keeps this stable
    const pinnedNames = pinned?.join("\n") ?? "";
    const isPinned = useCallback(
        (routeName: string) =>
            Platform.OS !== "ios" ||
            pinnedNames.split("\n").includes(routeName),
        [pinnedNames],
    );

    // every rail in the stack is the same bar, so one measurement serves all
    const [railHeight, setRailHeight] = useState<number | null>(null);

    const value = useMemo(
        () => ({ revealFor, isPinned, railHeight, setRailHeight }),
        [revealFor, isPinned, railHeight],
    );

    return (
        <TopRailContext.Provider value={value}>
            {children}
        </TopRailContext.Provider>
    );
}

type RouteRef = { key: string; name: string };

/**
 * The floating rail over `route`: its reveal, the height its page keeps clear
 * for it, and where the rail reports that height. Null when the route has no
 * rail, or a pinned one.
 *
 * The height is the rail as measured. Until it first lays out, it is the sum
 * of what the rail is built from, so a page mounting first does not start
 * tucked under it.
 */
export function useFloatingRail(route?: RouteRef) {
    const rail = useContext(TopRailContext);
    const insets = useSafeAreaInsets();
    if (!rail || !route || rail.isPinned(route.name)) return null;
    return {
        reveal: rail.revealFor(route.key),
        height: rail.railHeight ?? insets.top + TOP_RAIL_HEIGHT,
        onMeasure: rail.setRailHeight,
    };
}

/** The floating rail over the calling screen, or null when it has none. */
export function useScreenFloatingRail() {
    return useFloatingRail(useContext(NavigationRouteContext));
}

/**
 * The top padding the calling screen's content takes under a floating rail:
 * the rail's height plus the shared gap below it. Null when it has none, so
 * the content keeps its own. `useScreenScroll` applies it to the scroller; a
 * loading state drawn outside the scroller reads it here.
 */
export function useTopRailInset(): number | null {
    const rail = useScreenFloatingRail();
    return rail ? rail.height + RAIL_CONTENT_GAP : null;
}
