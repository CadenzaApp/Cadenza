import { useRouter } from "expo-router";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    StyleSheet,
    useWindowDimensions,
    View,
    type View as RNView,
} from "react-native";
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import {
    zoomCloseDuration,
    zoomGeometry,
    ZOOM_OPEN_DURATION,
    type ZoomRect,
} from "./zoom-dismiss-geometry";

/**
 * Closing a pushed screen by shrinking it back into whatever opened it.
 *
 * Two halves that know nothing about each other. A row records where it is on
 * screen just before it navigates (`useZoomSource`), and the screen that opens
 * shrinks toward that rect on the way out (`ZoomDismissScreen`). A screen with
 * no recorded rect still minimizes, just toward the bottom of the window, so a
 * deep link is never a broken transition.
 *
 * Everything runs on the UI thread: the pull drives `progress` straight from
 * the scroll handler, and the pop only happens once the animation finishes.
 */

export type ZoomOrigin = ZoomRect & {
    /** When it was measured. See `ORIGIN_MAX_AGE`. */
    at: number;
};

const ZOOM_EASING = Easing.bezier(0.32, 0.72, 0, 1);
/**
 * How stale a rect may be, relative to when the screen mounted, and still count
 * as the thing that opened it. Without this a screen opened by something that
 * records nothing would grow out of whatever row was tapped minutes ago.
 * Measured against mount rather than now, so a rect that lands a frame late
 * still counts and the screen keeps the same target for as long as it is open.
 */
const ORIGIN_MAX_AGE = 1500;

type ZoomOriginStore = {
    origin: SharedValue<ZoomOrigin | null>;
    record: (rect: ZoomOrigin) => void;
};

const ZoomOriginContext = createContext<ZoomOriginStore | null>(null);

export type ZoomDismissController = {
    /** 0 is the full screen, 1 is fully minimized into the origin rect. */
    progress: SharedValue<number>;
    /** True once the close is committed, so nothing else may drive progress. */
    closing: SharedValue<boolean>;
    /** Runs the minimize, then pops. */
    close: () => void;
    /** Finishes a close already committed by the UI-thread scroll handler. */
    finishGestureClose: () => void;
};

const ZoomDismissContext = createContext<ZoomDismissController | null>(null);

/**
 * Holds the rect of the last thing that navigated. One slot, not a map: only
 * the screen on top is ever closing, and it came from the last recorded row.
 */
export function ZoomOriginProvider({ children }: { children: ReactNode }) {
    const origin = useSharedValue<ZoomOrigin | null>(null);
    const record = useCallback(
        (rect: ZoomOrigin) => {
            origin.set(rect);
        },
        [origin],
    );
    const store = useMemo(() => ({ origin, record }), [origin, record]);

    return (
        <ZoomOriginContext.Provider value={store}>
            {children}
        </ZoomOriginContext.Provider>
    );
}

/**
 * What a row spreads to become a zoom target:
 *
 * ```tsx
 * const { ref: zoomRef, capture: captureZoom } = useZoomSource();
 * <View ref={zoomRef} collapsable={false}>...artwork...</View>
 * ```
 *
 * Destructure it. Passing `zoom.ref` straight through trips the react-compiler
 * rule about touching refs during render. Put the ref on the artwork rather
 * than the whole row: the artwork is what the screen grows out of, and a
 * full-width row barely shrinks at all.
 *
 * `capture` measures in window coordinates, which is asynchronous, so the rect
 * can land a frame after the push. That is why the origin is a shared value the
 * animation reads every frame rather than a snapshot taken at mount.
 */
export function useZoomSource() {
    const store = useContext(ZoomOriginContext);
    const ref = useRef<RNView>(null);

    const capture = useCallback(() => {
        if (!store) return;
        ref.current?.measureInWindow((x, y, width, height) => {
            if (width <= 0 || height <= 0) return;
            store.record({ x, y, width, height, at: Date.now() });
        });
    }, [store]);

    return { ref, capture };
}

/** The controller for the screen this is called from, or null outside one. */
export function useZoomDismiss() {
    return useContext(ZoomDismissContext);
}

/**
 * Closes the screen: the minimize if it is wrapped in `ZoomDismissScreen`, a
 * plain pop otherwise. Every close button goes through this, so the X and the
 * pull do the same thing.
 */
export function useCloseScreen() {
    const controller = useZoomDismiss();
    const router = useRouter();

    return useCallback(() => {
        if (controller) {
            controller.close();
            return;
        }
        if (router.canGoBack()) router.back();
    }, [controller, router]);
}

/**
 * Wraps a pushed screen's content in the card that grows out of the artwork on
 * the way in and shrinks back into it on the way out.
 *
 * Both directions are this one animation, which is why the routes are presented
 * with no native animation at all (`pushedScreenOptions` in `@/lib/theme`).
 * They are transparent modals, so the screen that opened this one is still
 * there underneath: the card shrinks over it rather than over black, and the
 * rounded corners show it at rest.
 */
export function ZoomDismissScreen({ children }: { children: ReactNode }) {
    const store = useContext(ZoomOriginContext);
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    // Starts minimized and grows, so the first frame is the artwork rather
    // than a full screen that then has to be animated down.
    const [mountedAt] = useState(() => Date.now());
    const progress = useSharedValue(1);
    const closing = useSharedValue(false);
    const cardVisible = useSharedValue(1);
    const origin = store?.origin;

    useEffect(() => {
        cardVisible.set(1);
        progress.set(
            withTiming(0, {
                duration: ZOOM_OPEN_DURATION,
                easing: ZOOM_EASING,
            }),
        );
    }, [cardVisible, progress]);

    const pop = useCallback(() => {
        if (router.canGoBack()) router.back();
    }, [router]);

    const runCloseAnimation = useCallback(() => {
        const duration = zoomCloseDuration(progress.get());
        progress.set(
            withTiming(1, { duration, easing: ZOOM_EASING }, (finished) => {
                if (!finished) return;
                // Reveal the source immediately. A delayed JS pop cannot
                // leave the minimized card hovering over the artwork.
                cardVisible.set(0);
                runOnJS(pop)();
            }),
        );
    }, [cardVisible, pop, progress]);

    const close = useCallback(() => {
        if (closing.get()) return;
        closing.set(true);
        runCloseAnimation();
    }, [closing, runCloseAnimation]);

    const finishGestureClose = useCallback(() => {
        // The scroll handler sets `closing` before returning to iOS, so the
        // rebound cannot pull progress back toward zero during this handoff.
        runCloseAnimation();
    }, [runCloseAnimation]);

    const controller = useMemo(
        () => ({ progress, closing, close, finishGestureClose }),
        [progress, closing, close, finishGestureClose],
    );

    const cardStyle = useAnimatedStyle(() => {
        const p = progress.get();
        const recorded = origin?.get() ?? null;
        const rect =
            recorded && recorded.at >= mountedAt - ORIGIN_MAX_AGE
                ? recorded
                : null;
        const geometry = zoomGeometry(width, height, rect, p);

        return {
            opacity: cardVisible.get(),
            borderRadius: geometry.borderRadius,
            transform: [
                { translateX: geometry.translateX },
                { translateY: geometry.translateY },
                { scale: geometry.scale },
            ],
            // No fade. A card you can see the old screen through while it
            // shrinks reads as muddy rather than as depth.
        };
    });

    return (
        <ZoomDismissContext.Provider value={controller}>
            <View style={styles.root}>
                <Animated.View style={[styles.card, cardStyle]}>
                    {children}
                </Animated.View>
            </View>
        </ZoomDismissContext.Provider>
    );
}

/** Springs the card back to full size after a pull that did not commit. */
export function resetZoomProgress(progress: SharedValue<number>) {
    "worklet";
    progress.set(withSpring(0, { damping: 20, stiffness: 220 }));
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    // The animated radius compensates for the card's scale. `borderCurve` is
    // what makes the result a continuous squircle rather than a quarter circle.
    card: {
        flex: 1,
        borderCurve: "continuous",
        overflow: "hidden",
    },
});
