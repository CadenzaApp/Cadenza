import { useRouter } from "expo-router";
import { useIsFocused, useScrollToTop } from "expo-router/react-navigation";
import { useCallback, useEffect } from "react";
import {
    useAnimatedRef,
    useAnimatedStyle,
    useAnimatedScrollHandler,
    runOnJS,
    useSharedValue,
    type AnimatedStyle,
    type AnimatedRef,
} from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import type { Component } from "react";
import type { ViewStyle } from "react-native";

import { usePlayerDock } from "./player-dock";
import {
    useIsPushedDetailScreen,
    useScreenOverlayInsets,
} from "./screen-overlay";
import { resetZoomProgress, useZoomDismiss } from "./zoom-dismiss";
import {
    shouldDismissZoom,
    zoomProgressForScrollOffset,
} from "./zoom-dismiss-geometry";

/** Scrolled past this, the player docks. */
const DOCK_OFFSET = 8;
/** Back within this of the top, it floats again. */
const TOP_OFFSET = 2;
type ScreenScrollProps<T extends Component> = {
    ref: AnimatedRef<T>;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
    scrollEventThrottle: number;
    style: AnimatedStyle<ViewStyle>;
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
 * It buys three things. Pressing the tab you are already on scrolls back to the
 * top, scrolling away from the top docks the mini player into the tab bar, and
 * on a pushed detail screen a pull down at the top shrinks it and then closes
 * it, the same minimize the X plays. A surface that skips this hook keeps the
 * player floating and does nothing on a tab press, which is the old behavior
 * rather than a broken one.
 */
export function useScreenScroll<
    T extends Component = Animated.ScrollView,
>(): ScreenScrollProps<T> {
    const ref = useAnimatedRef<T>();
    const { dock, float } = usePlayerDock();
    const { compactPlayerVisible } = useScreenOverlayInsets();
    const isFocused = useIsFocused();
    const router = useRouter();
    const canPullToDismiss = useIsPushedDetailScreen();
    const zoom = useZoomDismiss();
    // A screen with no zoom card still needs somewhere to write the pull, so
    // the handler can stay one shape rather than two.
    const spareProgress = useSharedValue(0);
    const spareClosing = useSharedValue(false);
    const pullOffset = useSharedValue(0);
    const progress = zoom?.progress ?? spareProgress;
    const closing = zoom?.closing ?? spareClosing;
    const compensatesZoomPull = canPullToDismiss && zoom != null;

    // `useScrollToTop` types itself against the navigation scrollables rather
    // than an animated ref. It only ever calls a scroll method on it.
    useScrollToTop(ref as never);

    // A tab keeps scrolling for a moment after you leave it, and an unfocused
    // screen has no business moving the player. Neither does any screen when
    // there is no player: the tab bar would clear a space for nothing.
    const setDocked = useCallback(
        (docked: boolean) => {
            if (!isFocused || !compactPlayerVisible) return;
            if (docked) dock();
            else float();
        },
        [isFocused, compactPlayerVisible, dock, float],
    );

    // A screen left behind should not keep the player docked for the next one,
    // and neither should a song that stopped playing.
    useEffect(() => {
        if (!isFocused || !compactPlayerVisible) {
            float();
            return;
        }
        return () => float();
    }, [isFocused, compactPlayerVisible, float]);

    // Android does not overscroll past the top by default, so the pull is an
    // iOS gesture. The X is on every one of these screens regardless.
    const dismiss = useCallback(() => {
        if (!isFocused || !canPullToDismiss) return;
        if (zoom) {
            zoom.finishGestureClose();
            return;
        }
        if (router.canGoBack()) router.back();
    }, [isFocused, canPullToDismiss, zoom, router]);

    const onScroll = useAnimatedScrollHandler(
        {
            onScroll: (event) => {
                const offset = event.contentOffset.y;
                if (offset > DOCK_OFFSET) runOnJS(setDocked)(true);
                else if (offset <= TOP_OFFSET) runOnJS(setDocked)(false);

                // iOS moves the scroll content down while overscrolling. Move
                // the scroll view up by the same amount so the hero stays
                // anchored inside the shrinking card instead of growing a
                // large empty area above it.
                pullOffset.set(compensatesZoomPull ? Math.min(offset, 0) : 0);

                // Once the close is committed the animation owns progress.
                if (!canPullToDismiss || closing.get()) return;
                progress.set(zoomProgressForScrollOffset(offset));
            },
            onEndDrag: (event) => {
                if (!canPullToDismiss || closing.get()) return;
                if (shouldDismissZoom(event.contentOffset.y)) {
                    // Claim the animation before iOS starts rebounding the
                    // scroll view. The JS callback only finishes the close.
                    closing.set(true);
                    runOnJS(dismiss)();
                    return;
                }
                resetZoomProgress(progress);
            },
        },
        [
            setDocked,
            dismiss,
            canPullToDismiss,
            compensatesZoomPull,
            closing,
            progress,
            pullOffset,
        ],
    );

    const pullCompensationStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: pullOffset.get() }],
    }));

    return {
        ref,
        onScroll,
        scrollEventThrottle: 16,
        style: pullCompensationStyle,
    };
}
