import { useRouter } from "expo-router";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
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
    makeMutable,
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

export type ZoomOrigin = ZoomRect;

const ZOOM_EASING = Easing.bezier(0.32, 0.72, 0, 1);
/** A measured source only belongs to the navigation immediately after it. */
const LAUNCH_TICKET_MAX_AGE = 1500;

type ZoomViewport = {
    width: number;
    height: number;
};

type ZoomLaunchTicket = {
    createdAt: number;
    viewport: ZoomViewport;
    origin: SharedValue<ZoomOrigin | null>;
};

type ZoomOriginStore = {
    beginLaunch: (viewport: ZoomViewport) => ZoomLaunchTicket;
    peekLaunch: (viewport: ZoomViewport) => ZoomLaunchTicket | null;
    consumeLaunch: (ticket: ZoomLaunchTicket) => void;
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
 * Hands each pushed screen its own launch measurement. A screen keeps the
 * ticket it claims, so a nested push cannot replace its eventual close target.
 * The store itself stays stable and does not rerender every source row.
 */
export function ZoomOriginProvider({ children }: { children: ReactNode }) {
    const pendingLaunch = useRef<ZoomLaunchTicket | null>(null);
    const beginLaunch = useCallback((viewport: ZoomViewport) => {
        const ticket = {
            createdAt: Date.now(),
            viewport,
            origin: makeMutable<ZoomOrigin | null>(null),
        };
        pendingLaunch.current = ticket;
        return ticket;
    }, []);
    const peekLaunch = useCallback((viewport: ZoomViewport) => {
        const ticket = pendingLaunch.current;
        if (!ticket) return null;

        const fresh = Date.now() - ticket.createdAt <= LAUNCH_TICKET_MAX_AGE;
        const sameViewport =
            ticket.viewport.width === viewport.width &&
            ticket.viewport.height === viewport.height;
        return fresh && sameViewport ? ticket : null;
    }, []);
    const consumeLaunch = useCallback((ticket: ZoomLaunchTicket) => {
        if (pendingLaunch.current === ticket) pendingLaunch.current = null;
    }, []);
    const store = useMemo(
        () => ({ beginLaunch, peekLaunch, consumeLaunch }),
        [beginLaunch, consumeLaunch, peekLaunch],
    );

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
    const viewport = useWindowDimensions();

    const capture = useCallback(() => {
        if (!store) return;
        const ticket = store.beginLaunch({
            width: viewport.width,
            height: viewport.height,
        });
        ref.current?.measureInWindow((x, y, width, height) => {
            if (width <= 0 || height <= 0) return;
            ticket.origin.set({ x, y, width, height });
        });
    }, [store, viewport.height, viewport.width]);

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
export function ZoomDismissScreen({
    children,
    overlay,
}: {
    children: ReactNode;
    /** Chrome that should transform and clip with this particular card. */
    overlay?: ReactNode;
}) {
    const store = useContext(ZoomOriginContext);
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    // Starts minimized and grows, so the first frame is the artwork rather
    // than a full screen that then has to be animated down.
    const fallbackOrigin = useSharedValue<ZoomOrigin | null>(null);
    const [launch] = useState(() => store?.peekLaunch({ width, height }));
    const progress = useSharedValue(1);
    const closing = useSharedValue(false);
    const cardVisible = useSharedValue(1);
    const animationGeneration = useSharedValue(0);
    const launchMatchesViewport =
        launch?.viewport.width === width && launch.viewport.height === height;
    const origin = launchMatchesViewport ? launch.origin : fallbackOrigin;

    useLayoutEffect(() => {
        if (launch) store?.consumeLaunch(launch);
    }, [launch, store]);

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
        if (router.canGoBack()) {
            router.back();
            return;
        }

        // A deep-linked route may have nowhere to pop. Do not leave its card
        // invisible and permanently latched in the closing state.
        cardVisible.set(1);
        closing.set(false);
        progress.set(withSpring(0, { damping: 20, stiffness: 220 }));
    }, [cardVisible, closing, progress, router]);

    const runCloseAnimation = useCallback(() => {
        const generation = animationGeneration.get() + 1;
        animationGeneration.set(generation);
        const duration = zoomCloseDuration(progress.get());
        progress.set(
            withTiming(1, { duration, easing: ZOOM_EASING }, (finished) => {
                if (animationGeneration.get() !== generation) return;
                if (!finished) {
                    closing.set(false);
                    progress.set(
                        withSpring(0, { damping: 20, stiffness: 220 }),
                    );
                    return;
                }
                // Reveal the source immediately. A delayed JS pop cannot
                // leave the minimized card hovering over the artwork.
                cardVisible.set(0);
                runOnJS(pop)();
            }),
        );
    }, [animationGeneration, cardVisible, closing, pop, progress]);

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
        const rect = origin.get();
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
                    {overlay}
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
