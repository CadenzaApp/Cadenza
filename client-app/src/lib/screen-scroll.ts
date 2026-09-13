import { useIsFocused, useScrollToTop } from "expo-router/react-navigation";
import { useCallback, useEffect } from "react";
import {
    useAnimatedRef,
    useAnimatedScrollHandler,
    runOnJS,
    type AnimatedRef,
} from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import type { Component } from "react";

import { usePlayerDock } from "./player-dock";

/** Scrolled past this, the player docks. */
const DOCK_OFFSET = 8;
/** Back within this of the top, it floats again. */
const TOP_OFFSET = 2;

type ScreenScrollProps<T extends Component> = {
    ref: AnimatedRef<T>;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
    scrollEventThrottle: number;
};

/**
 * Wiring for a tab screen's top-level scroller. Spread it onto an
 * `Animated.FlatList` or `Animated.ScrollView`:
 *
 * ```tsx
 * const scroll = useScreenScroll();
 * <Animated.FlatList {...scroll} ... />
 * ```
 *
 * It buys two things. Pressing the tab you are already on scrolls back to the
 * top, and scrolling away from the top docks the mini player into the tab bar.
 * A surface that skips this hook keeps the player floating and does nothing on
 * a tab press, which is the old behavior rather than a broken one.
 */
export function useScreenScroll<
    T extends Component = Animated.ScrollView,
>(): ScreenScrollProps<T> {
    const ref = useAnimatedRef<T>();
    const { dock, float } = usePlayerDock();
    const isFocused = useIsFocused();

    // `useScrollToTop` types itself against the navigation scrollables rather
    // than an animated ref. It only ever calls a scroll method on it.
    useScrollToTop(ref as never);

    // A tab keeps scrolling for a moment after you leave it, and an unfocused
    // screen has no business moving the player.
    const setDocked = useCallback(
        (docked: boolean) => {
            if (!isFocused) return;
            if (docked) dock();
            else float();
        },
        [isFocused, dock, float],
    );

    // A screen left behind should not keep the player docked for the next one.
    useEffect(() => {
        if (!isFocused) return;
        return () => float();
    }, [isFocused, float]);

    const onScroll = useAnimatedScrollHandler(
        {
            onScroll: (event) => {
                const offset = event.contentOffset.y;
                if (offset > DOCK_OFFSET) runOnJS(setDocked)(true);
                else if (offset <= TOP_OFFSET) runOnJS(setDocked)(false);
            },
        },
        [setDocked],
    );

    return { ref, onScroll, scrollEventThrottle: 16 };
}
