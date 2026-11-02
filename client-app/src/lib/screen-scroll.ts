import { useScrollToTop } from "expo-router/react-navigation";
import {
    Easing,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useSharedValue,
    withTiming,
    type AnimatedRef,
} from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import type { Component, ElementType } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { useScreenFloatingRail, useTopRailInset } from "./top-rail";
import { nextRailShown } from "./top-rail-geometry";

/** Short and eased out, so the rail settles in rather than snapping. */
const RAIL_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };

/** A scroller instance, or a component type whose ref is one. */
type Scroller = Component | ElementType;

type ScreenScrollProps<T extends Scroller> = {
    ref: AnimatedRef<T>;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
    scrollEventThrottle: number;
    /**
     * The top padding a floating rail needs, undefined with none. A scroller
     * with its own content style lists this last in it, so it wins over the
     * page's own top padding.
     */
    contentContainerStyle: StyleProp<ViewStyle>;
};

/** What `useScreenScroll()` returns for an animated scroll view. */
export type ScreenScrollBinding = ScreenScrollProps<Animated.ScrollView>;

/**
 * Wiring for a tab screen's top-level scroller. Spread it onto an
 * `Animated.FlatList` or `Animated.ScrollView`:
 *
 * ```tsx
 * const scroll = useScreenScroll();
 * <Animated.FlatList
 *     {...scroll}
 *     contentContainerStyle={[{ paddingBottom }, scroll.contentContainerStyle]}
 * />
 * ```
 *
 * It handles active-tab scroll-to-top and the floating `TopRail`. Under a
 * floating rail it sets the
 * content's top padding to the rail's height plus the shared gap, the same on
 * every page, then hides the rail on a scroll down and brings it back at the
 * top (see `@/lib/top-rail`). Place the scroller inside `ScreenScrollMarker` so nested
 * stacks and virtualized lists register that native scroll view with UIKit for
 * native insets, scroll-to-top, and tab-bar/accessory minimization.
 */
export function useScreenScroll<
    T extends Scroller = Animated.ScrollView,
>(): ScreenScrollProps<T> {
    const ref = useAnimatedRef<T>();
    // a screen without a floating rail still gets one shape of handler
    const spareProgress = useSharedValue(1);
    const spareTarget = useSharedValue(1);
    const rail = useScreenFloatingRail();
    const railProgress = rail?.reveal.progress ?? spareProgress;
    const railTarget = rail?.reveal.target ?? spareTarget;
    const hasRail = rail != null;
    const railInset = useTopRailInset();
    const lastOffset = useSharedValue(0);

    // `useScrollToTop` types itself against the navigation scrollables rather
    // than an animated ref. It only ever calls a scroll method on it.
    useScrollToTop(ref as never);

    const onScroll = useAnimatedScrollHandler(
        {
            onScroll: (event) => {
                if (!hasRail) return;
                const offset = event.contentOffset.y;
                const shown = nextRailShown(
                    railTarget.get(),
                    lastOffset.get(),
                    offset,
                );
                lastOffset.set(offset);
                if (shown !== railTarget.get()) {
                    railTarget.set(shown);
                    railProgress.set(withTiming(shown, RAIL_TIMING));
                }
            },
        },
        [hasRail, railProgress, railTarget, lastOffset],
    );

    return {
        ref,
        onScroll,
        scrollEventThrottle: 16,
        // padding rather than a native content inset: 0 stays the top, so
        // scroll-to-top and the first frame need nothing special
        contentContainerStyle:
            railInset === null ? undefined : { paddingTop: railInset },
    };
}
