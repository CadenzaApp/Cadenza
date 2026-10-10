import { useRouter } from "expo-router";
import { useIsFocused, useScrollToTop } from "expo-router/react-navigation";
import { useCallback } from "react";
import {
    Easing,
    useAnimatedRef,
    useAnimatedStyle,
    useAnimatedScrollHandler,
    runOnJS,
    useSharedValue,
    withTiming,
    type AnimatedStyle,
    type AnimatedRef,
} from "react-native-reanimated";
import type Animated from "react-native-reanimated";
import type { Component, ElementType } from "react";
import type { StyleProp, ViewStyle } from "react-native";

import { useIsPushedDetailScreen } from "./screen-overlay";
import { useScreenFloatingRail, useTopRailInset } from "./top-rail";
import { nextRailShown } from "./top-rail-geometry";
import { resetZoomProgress, useZoomDismiss } from "./zoom-dismiss";
import {
    shouldDismissZoom,
    zoomProgressForScrollOffset,
} from "./zoom-dismiss-geometry";

/** Short and eased out, so the rail settles in rather than snapping. */
const RAIL_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };

/** A scroller instance, or a component type whose ref is one. */
type Scroller = Component | ElementType;

type ScreenScrollProps<T extends Scroller> = {
    ref: AnimatedRef<T>;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
    scrollEventThrottle: number;
    style: AnimatedStyle<ViewStyle>;
    /**
     * The top padding a floating rail needs, undefined with none. A scroller
     * with its own content style lists this last in it, so it wins over the
     * page's own top padding.
     */
    contentContainerStyle: StyleProp<ViewStyle>;
};

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
 * It handles active-tab scroll-to-top, the floating `TopRail`, and, on pushed
 * detail screens, the pull-down close. Under a floating rail it sets the
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
    const isFocused = useIsFocused();
    const router = useRouter();
    const canPullToDismiss = useIsPushedDetailScreen();
    const zoom = useZoomDismiss();
    // A screen with no zoom card still needs somewhere to write the pull, so
    // the handler can stay one shape rather than two.
    const spareZoomProgress = useSharedValue(0);
    const spareClosing = useSharedValue(false);
    const pullOffset = useSharedValue(0);
    // the close follows a finger pulling past the top, nothing else: momentum
    // and a list nudging its own offset while it lays out rows report negative
    // offsets too, and with no drag ending after them nothing let the close go
    const dragging = useSharedValue(false);
    // a screen without a floating rail still gets one shape of handler
    const spareProgress = useSharedValue(1);
    const spareTarget = useSharedValue(1);
    const rail = useScreenFloatingRail();
    const railProgress = rail?.reveal.progress ?? spareProgress;
    const railTarget = rail?.reveal.target ?? spareTarget;
    const hasRail = rail != null;
    const railInset = useTopRailInset();
    const lastOffset = useSharedValue(0);
    const progress = zoom?.progress ?? spareZoomProgress;
    const closing = zoom?.closing ?? spareClosing;
    const compensatesZoomPull = canPullToDismiss && zoom != null;

    // `useScrollToTop` types itself against the navigation scrollables rather
    // than an animated ref. It only ever calls a scroll method on it.
    useScrollToTop(ref as never);

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

                if (hasRail) {
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
                }
                // iOS moves the scroll content down while overscrolling. Move
                // the scroll view up by the same amount so the hero stays
                // anchored inside the shrinking card instead of growing a
                // large empty area above it.
                pullOffset.set(compensatesZoomPull ? Math.min(offset, 0) : 0);

                // Once the close is committed the animation owns progress.
                if (!canPullToDismiss || closing.get() || !dragging.get()) {
                    return;
                }
                progress.set(zoomProgressForScrollOffset(offset));
            },
            onBeginDrag: () => {
                dragging.set(true);
            },
            onEndDrag: (event) => {
                dragging.set(false);
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
            onMomentumEnd: () => {
                // whatever moved it, a resting list is never mid close
                if (!canPullToDismiss || closing.get()) return;
                if (progress.get() > 0) resetZoomProgress(progress);
            },
        },
        [
            dragging,
            dismiss,
            canPullToDismiss,
            compensatesZoomPull,
            closing,
            progress,
            pullOffset,
            hasRail,
            railProgress,
            railTarget,
            lastOffset,
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
        // padding rather than a native content inset: 0 stays the top, so
        // scroll-to-top and the first frame need nothing special
        contentContainerStyle:
            railInset === null ? undefined : { paddingTop: railInset },
    };
}
