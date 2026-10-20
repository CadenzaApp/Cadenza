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
    type RefObject,
} from "react";
import {
    Platform,
    StyleSheet,
    useWindowDimensions,
    View,
    type View as RNView,
} from "react-native";
import Animated, {
    Easing,
    makeMutable,
    runOnJS,
    runOnUI,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import {
    visibleFocus,
    zoomCloseDuration,
    zoomFrame,
    zoomOpenFrame,
    zoomSourceFromSheet,
    zoomPointFrame,
    zoomPageOpacity,
    ZOOM_OPEN_DURATION,
    type ZoomRect,
} from "./zoom-dismiss-geometry";

import { SkeletonAnimationContext } from "@/components/ui/skeleton";

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

type ZoomAnchor = "artwork" | "point";

type ZoomLaunchTicket = {
    anchor: ZoomAnchor;
    createdAt: number;
    viewport: ZoomViewport;
    origin: SharedValue<ZoomOrigin | null>;
};

type ZoomOriginStore = {
    beginLaunch: (
        viewport: ZoomViewport,
        anchor: ZoomAnchor,
    ) => ZoomLaunchTicket;
    peekLaunch: (viewport: ZoomViewport) => ZoomLaunchTicket | null;
    consumeLaunch: (ticket: ZoomLaunchTicket) => void;
};

const ZoomOriginContext = createContext<ZoomOriginStore | null>(null);

type MeasureSource = (
    source: RNView,
    receive: (rect: ZoomRect) => void,
) => void;
const ZoomSheetSourceContext = createContext<MeasureSource | null>(null);

/** Give sheet links a physical window target, including the native sheet offset. */
export function ZoomSheetSourceScope({ children }: { children: ReactNode }) {
    const ref = useRef<RNView>(null);
    const { width, height } = useWindowDimensions();
    const measureSource = useCallback<MeasureSource>(
        (source, receive) => {
            const sheet = ref.current;
            if (!sheet) return;
            sheet.measureInWindow((x, y, sheetWidth, sheetHeight) => {
                if (sheetWidth <= 0 || sheetHeight <= 0) return;
                source.measureInWindow((sx, sy, sw, sh) => {
                    receive(
                        zoomSourceFromSheet(
                            { x: sx, y: sy, width: sw, height: sh },
                            { x, y, width: sheetWidth, height: sheetHeight },
                            { width, height },
                        ),
                    );
                });
            });
        },
        [width, height],
    );
    if (Platform.OS !== "ios") return children;
    return (
        <ZoomSheetSourceContext.Provider value={measureSource}>
            <View ref={ref} collapsable={false} className="flex-1">
                {children}
            </View>
        </ZoomSheetSourceContext.Provider>
    );
}

/** A copy of a screen's artwork, and the size it draws at unscaled. */
export type ZoomArtwork = { node: ReactNode; width: number; height: number };

export type ZoomDismissController = {
    /** 0 is the full screen, 1 is fully minimized into the origin rect. */
    progress: SharedValue<number>;
    /** True once the close is committed, so nothing else may drive progress. */
    closing: SharedValue<boolean>;
    /** Runs the minimize, then pops. */
    close: () => void;
    /** Finishes a close already committed by the UI-thread scroll handler. */
    finishGestureClose: () => void;
    /**
     * Where the screen's artwork is while the card is full size, set by the
     * screen as it scrolls. The close lands this on the tile it opened from.
     * Null closes on the top of the page instead.
     */
    focus: SharedValue<ZoomRect | null>;
    /** The page, for a screen to measure its artwork against. */
    pageRef: RefObject<RNView | null>;
    /**
     * A copy of the screen's artwork, drawn over the page while it moves. The
     * page fades and this stays, so the close reads as the artwork shrinking
     * back into its tile. Null keeps the whole page visible instead.
     */
    setArtwork: (artwork: ZoomArtwork | null) => void;
    /** True once the open has finished, for holding heavy rendering back. */
    opened: boolean;
};

const ZoomDismissContext = createContext<ZoomDismissController | null>(null);

/**
 * Hands each pushed screen its own launch measurement. A screen keeps the
 * ticket it claims, so a nested push cannot replace its eventual close target.
 * The store itself stays stable and does not rerender every source row.
 */
export function ZoomOriginProvider({ children }: { children: ReactNode }) {
    const pendingLaunch = useRef<ZoomLaunchTicket | null>(null);
    const beginLaunch = useCallback(
        (viewport: ZoomViewport, anchor: ZoomAnchor) => {
            const ticket = {
                anchor,
                createdAt: Date.now(),
                viewport,
                origin: makeMutable<ZoomOrigin | null>(null),
            };
            pendingLaunch.current = ticket;
            return ticket;
        },
        [],
    );
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
export function useZoomSource(anchor: ZoomAnchor = "artwork") {
    const store = useContext(ZoomOriginContext);
    const measureSheetSource = useContext(ZoomSheetSourceContext);
    const ref = useRef<RNView>(null);
    const viewport = useWindowDimensions();

    const capture = useCallback(() => {
        if (!store) return;
        const ticket = store.beginLaunch(
            {
                width: viewport.width,
                height: viewport.height,
            },
            anchor,
        );
        const source = ref.current;
        if (!source) return;
        const receive = (rect: ZoomRect) => {
            if (rect.width > 0 && rect.height > 0) ticket.origin.set(rect);
        };
        if (measureSheetSource) {
            measureSheetSource(source, receive);
        } else {
            source.measureInWindow((x, y, width, height) =>
                receive({ x, y, width, height }),
            );
        }
    }, [anchor, store, measureSheetSource, viewport.height, viewport.width]);

    return { ref, capture };
}

/** The controller for the screen this is called from, or null outside one. */
export function useZoomDismiss() {
    return useContext(ZoomDismissContext);
}

/**
 * Where a screen reports its artwork for the close to land on its tile, or
 * null outside a zoom card. Set it in screen points, as laid out at full size.
 */
export function useZoomFocus() {
    return useContext(ZoomDismissContext)?.focus ?? null;
}

/**
 * Whether this screen's zoom card has finished opening, or null outside one.
 * The card runs its own open, so a navigation transition event says nothing.
 */
export function useZoomOpened() {
    const controller = useContext(ZoomDismissContext);
    return controller ? controller.opened : null;
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
    const focus = useSharedValue<ZoomRect | null>(null);
    // the artwork as it was when the card last left rest. the styles read
    // this, not `focus`, which moves on every scroll frame and would restyle
    // the whole card on each of them
    const movingFocus = useSharedValue<ZoomRect | null>(null);
    const cardVisible = useSharedValue(1);
    const animationGeneration = useSharedValue(0);
    // true until the card first reaches full size: the open and the close
    // move differently
    const opening = useSharedValue(true);
    const pageRef = useRef<RNView>(null);
    const [artwork, setArtwork] = useState<ZoomArtwork | null>(null);
    const artworkWidth = useSharedValue(1);
    const hasArtwork = useSharedValue(false);
    const [opened, setOpened] = useState(false);
    const launchMatchesViewport =
        launch?.viewport.width === width && launch.viewport.height === height;
    const origin = launchMatchesViewport ? launch.origin : fallbackOrigin;
    const pointAnchor = launch?.anchor === "point";

    useLayoutEffect(() => {
        if (launch) store?.consumeLaunch(launch);
    }, [launch, store]);
    useEffect(() => {
        hasArtwork.set(artwork != null);
        if (artwork) artworkWidth.set(artwork.width);
    }, [artwork, artworkWidth, hasArtwork]);

    // Start at once. Data and duplicate artwork layers do not gate the open.
    useEffect(() => {
        progress.set(
            withTiming(0, {
                duration: ZOOM_OPEN_DURATION,
                easing: ZOOM_EASING,
            }),
        );
    }, [progress]);
    // opened once it reaches full size, however it got there: the timing's
    // own callback reports unfinished whenever anything else settles it.
    // from here on every move is a close, which fades and lands the artwork
    useAnimatedReaction(
        () => !closing.get() && progress.get() === 0,
        (atRest, wasAtRest) => {
            if (!atRest || wasAtRest) return;
            opening.set(false);
            runOnJS(setOpened)(true);
        },
    );
    // snapshot the artwork whenever the card sets off from rest; the page
    // does not scroll while the card moves
    useAnimatedReaction(
        () => progress.get() > 0,
        (moving, wasMoving) => {
            if (moving && !wasMoving) movingFocus.set(focus.get());
        },
    );

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

    const finishGestureClose = useCallback(() => {
        "worklet";
        if (closing.get()) return;
        opening.set(false);
        movingFocus.set(focus.get());
        closing.set(true);
        const generation = animationGeneration.get() + 1;
        animationGeneration.set(generation);
        progress.set(
            withTiming(
                1,
                {
                    duration: zoomCloseDuration(progress.get()),
                    easing: ZOOM_EASING,
                },
                (finished) => {
                    if (animationGeneration.get() !== generation) return;
                    if (!finished) {
                        closing.set(false);
                        progress.set(
                            withSpring(0, { damping: 20, stiffness: 220 }),
                        );
                        return;
                    }
                    cardVisible.set(0);
                    runOnJS(pop)();
                },
            ),
        );
    }, [
        closing,
        opening,
        movingFocus,
        focus,
        animationGeneration,
        progress,
        cardVisible,
        pop,
    ]);

    const close = useCallback(() => {
        runOnUI(finishGestureClose)();
    }, [finishGestureClose]);

    const controller = useMemo(
        () => ({
            progress,
            closing,
            close,
            finishGestureClose,
            focus,
            pageRef,
            setArtwork,
            opened,
        }),
        [
            progress,
            closing,
            close,
            finishGestureClose,
            focus,
            setArtwork,
            opened,
        ],
    );

    // Transforms only: the page moves and scales as one piece so its artwork
    // lands on the tile. With an artwork copy over it, the page fades early
    // and the copy is what reaches the tile.
    const pageStyle = useAnimatedStyle(() => {
        const p = progress.get();
        const isOpening = opening.get();
        const target = origin.get();
        const frame = pointAnchor
            ? zoomPointFrame(width, height, target, p)
            : isOpening
              ? zoomOpenFrame(width, height, target, p)
              : zoomFrame(width, height, target, movingFocus.get(), p);
        return {
            // only a close fades the page, and only with an artwork copy to
            // leave behind. the open never does: see `zoomOpenFrame`
            opacity:
                cardVisible.get() *
                (!pointAnchor && !isOpening && hasArtwork.get()
                    ? zoomPageOpacity(p)
                    : 1),
            borderRadius: frame.borderRadius,
            transform: [
                { translateX: frame.translateX },
                { translateY: frame.translateY },
                { scale: frame.scale },
            ],
        };
    });
    // the copy rides the same transform, so it stays exactly under the page's
    // artwork. shown only while the card is moving, never at rest
    const artworkLayerStyle = useAnimatedStyle(() => {
        const p = progress.get();
        const frame = zoomFrame(
            width,
            height,
            origin.get(),
            movingFocus.get(),
            p,
        );
        return {
            // only a close shows it, and only once the card has moved
            opacity:
                cardVisible.get() *
                (!pointAnchor && !opening.get() && p > 0.001 ? 1 : 0),
            transform: [
                { translateX: frame.translateX },
                { translateY: frame.translateY },
                { scale: frame.scale },
            ],
        };
    });
    // where the artwork sits on the page, and the copy scaled to fit it
    // there; only changes as the page scrolls
    const artworkBoxStyle = useAnimatedStyle(() => {
        const art = visibleFocus(width, height, movingFocus.get());
        return {
            transform: [
                { translateX: art.x },
                { translateY: art.y },
                { scale: art.width / artworkWidth.get() },
            ],
        };
    });

    return (
        <ZoomDismissContext.Provider value={controller}>
            <View style={styles.root}>
                {/* behind the page, so nothing covers it at rest: glass under
                    a full screen layer, even an invisible one, renders flat.
                    the page fades off this copy, which sits exactly where
                    the page's own artwork is */}
                {artwork ? (
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            styles.layer,
                            { width, height },
                            artworkLayerStyle,
                        ]}
                    >
                        <Animated.View
                            style={[
                                styles.layer,
                                {
                                    width: artwork.width,
                                    height: artwork.height,
                                },
                                artworkBoxStyle,
                            ]}
                        >
                            {artwork.node}
                        </Animated.View>
                    </Animated.View>
                ) : null}
                <Animated.View
                    ref={pageRef}
                    style={[styles.page, { width, height }, pageStyle]}
                >
                    <SkeletonAnimationContext.Provider value={opened}>
                        {children}
                        {overlay}
                    </SkeletonAnimationContext.Provider>
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
    // The page at full screen size, scaled from its top-left corner. The
    // animated radius compensates for that scale, and `borderCurve` makes the
    // corner a continuous squircle rather than a quarter circle.
    page: {
        position: "absolute",
        top: 0,
        left: 0,
        transformOrigin: "top left",
        borderCurve: "continuous",
        overflow: "hidden",
    },
    layer: {
        position: "absolute",
        top: 0,
        left: 0,
        transformOrigin: "top left",
    },
});
