import Ionicons from "@expo/vector-icons/Ionicons";
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";
import {
    AccessibilityInfo,
    Platform,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
    LinearTransition,
    ReduceMotion,
    runOnJS,
    SlideInRight,
    SlideOutRight,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { FullWindowOverlay } from "react-native-screens";

import {
    GlassSurface,
    shouldShowGlassOutline,
} from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { useAppTheme } from "@/lib/theme";
import { TOP_RAIL_HEIGHT } from "@/lib/top-rail-geometry";
import { cn } from "@/lib/utils";

type IconName = ComponentProps<typeof Ionicons>["name"];

/**
 * The icon on a row. `info`, `success`, and `error` are presets: `success`
 * draws a green check, and `error` a red cross with the text in red too. Any
 * other value is an Ionicons name, drawn in the text color.
 */
export type ToastIcon = "info" | "success" | "error" | IconName;

/** How long a one-off message stays on screen. */
const TOAST_MS = 5000;

/** How long a row takes to slide in or out from the right edge. */
const SLIDE_MS = 250;

const ENTERING = SlideInRight.duration(SLIDE_MS).reduceMotion(
    ReduceMotion.System,
);
const EXITING = SlideOutRight.duration(SLIDE_MS).reduceMotion(
    ReduceMotion.System,
);
/** The rows left behind close the gap instead of jumping into it. */
const LAYOUT = LinearTransition.duration(SLIDE_MS).reduceMotion(
    ReduceMotion.System,
);

/** How long an ended task keeps its icon on screen before its row goes. */
const LINGER_MS = 1000;

/** A drag right past this, or a flick, dismisses a row. */
const DISMISS_DRAG = 60;
const DISMISS_VELOCITY = 800;

/** How long a dismissed row takes to fly off, or a short drag to settle back. */
const SWIPE_SETTLE_MS = 150;

/** At most this many rows that are not running tasks. The oldest goes first. */
const MAX_MESSAGES = 3;

/** Gap between the top rail and the first row. */
const RAIL_GAP = 8;

/** Big enough to keep a one line row a round pill at any height. */
const PILL_RADIUS = 9999;

/** A row with a title is a card, since a pill that tall reads as a blob. */
const CARD_RADIUS = 16;

/** A fixed box for the icon, so the row does not jump when one replaces another. */
const ICON_BOX = 20;
const ICON_SIZE = 16;

const PRESET_ICONS: Record<"info" | "success" | "error", IconName> = {
    info: "information-circle",
    success: "checkmark-circle",
    error: "close-circle",
};

/**
 * Static rather than a spinner. The stack is a readout, so an animation on it
 * only pulled the eye away from what the user was doing.
 */
const RUNNING_ICON: IconName = "hourglass";

type Toast = {
    id: number;
    /** Bold, on its own line above the message. */
    title?: string;
    /** What the row reads. A failed task replaces its label with the failure. */
    message: string;
    icon: ToastIcon;
    /** A task that has not ended yet. It stays until it does. */
    running: boolean;
};

type ToastActions = {
    /**
     * Shows a message for 5 seconds, under a bold `title` when there is one,
     * beside `icon` (`info` by default). Every call adds its own row, even
     * one the same as a row already up.
     */
    showToast: (message: string, title?: string, icon?: ToastIcon) => void;
    /** Puts a running task on the stack and hands back its id. */
    startTask: (label: string) => number;
    /**
     * Swaps the task's hourglass for a check, then takes the row off a second
     * later. Ending the same task again does nothing.
     */
    endTaskSuccess: (id: number) => void;
    /**
     * The same with a cross, and `message` in place of the task's label. The
     * row draws both in red, so a failure reads as one even at a glance.
     */
    endTaskFail: (id: number, message: string) => void;
    /**
     * Takes a row off now. A swipe right does this. A dismissed task can
     * still be ended, which then does nothing.
     */
    dismissToast: (id: number) => void;
};

const ToastActionsContext = createContext<ToastActions | null>(null);

/**
 * The rows themselves, separate from the actions so that showing a toast does
 * not change the identity of `showToast` and the task functions.
 */
const ToastListContext = createContext<Toast[]>([]);

/**
 * Shows messages and task progress on the stack at the top right of the
 * screen. Every function keeps the same identity for the life of the
 * provider, so an effect or callback can list them in its dependencies.
 */
export function useToast() {
    const value = useContext(ToastActionsContext);
    if (!value) {
        throw new Error("useToast must be used under ToastProvider");
    }
    return value;
}

/**
 * Owns the rows. Mounted at the root, above anything that shows one. It draws
 * nothing: `ToastHost` does, from further down the tree.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    // the same list, read synchronously by the actions
    const current = useRef<Toast[]>([]);
    const nextId = useRef(0);
    const removalTimers = useRef(
        new Map<number, ReturnType<typeof setTimeout>>(),
    );

    const actions = useMemo<ToastActions>(() => {
        const commit = (next: Toast[]) => {
            current.current = next;
            setToasts(next);
        };

        const remove = (id: number) => {
            const timer = removalTimers.current.get(id);
            if (timer) clearTimeout(timer);
            removalTimers.current.delete(id);
            commit(current.current.filter((toast) => toast.id !== id));
        };

        const removeAfter = (id: number, ms: number) => {
            const timer = removalTimers.current.get(id);
            if (timer) clearTimeout(timer);
            removalTimers.current.set(
                id,
                setTimeout(() => remove(id), ms),
            );
        };

        const add = (toast: Omit<Toast, "id">) => {
            const id = nextId.current++;
            commit([...current.current, { id, ...toast }]);
            return id;
        };

        const endTask = (id: number, icon: ToastIcon, message?: string) => {
            const task = current.current.find((toast) => toast.id === id);
            // gone, or already ending, so leave its icon and its timer alone
            if (!task || !task.running) return;
            commit(
                current.current.map((toast) =>
                    toast.id === id
                        ? {
                              ...toast,
                              icon,
                              running: false,
                              message: message ?? toast.message,
                          }
                        : toast,
                ),
            );
            removeAfter(id, LINGER_MS);
        };

        return {
            showToast: (message, title, icon = "info") => {
                AccessibilityInfo.announceForAccessibility(
                    title ? `${title}. ${message}` : message,
                );
                const id = add({ title, message, icon, running: false });
                removeAfter(id, TOAST_MS);
                const messages = current.current.filter(
                    (toast) => !toast.running,
                );
                if (messages.length > MAX_MESSAGES) remove(messages[0].id);
            },
            startTask: (label) =>
                add({ message: label, icon: RUNNING_ICON, running: true }),
            endTaskSuccess: (id) => endTask(id, "success"),
            endTaskFail: (id, message) => endTask(id, "error", message),
            dismissToast: remove,
        };
    }, []);

    useEffect(() => {
        const timers = removalTimers.current;
        return () => {
            for (const timer of timers.values()) clearTimeout(timer);
            timers.clear();
        };
    }, []);

    return (
        <ToastActionsContext.Provider value={actions}>
            <ToastListContext.Provider value={toasts}>
                {children}
            </ToastListContext.Provider>
        </ToastActionsContext.Provider>
    );
}

/**
 * The floating stack itself. Draws nothing while there is no row, once the
 * last one has finished sliding out.
 *
 * Mounted beside `GlassBlurTarget` rather than inside `ToastProvider`,
 * because a row's glass only blurs on Android when it can read the blur
 * target, and the provider sits above `GlassBlurTargetProvider`.
 */
export function ToastHost() {
    const toasts = useContext(ToastListContext);
    const { dismissToast } = useToast();
    const insets = useSafeAreaInsets();
    const hasRows = toasts.length > 0;
    // stays true a moment past the last row, so its exit can play out
    const [held, setHeld] = useState(false);
    if (hasRows && !held) setHeld(true);

    useEffect(() => {
        if (hasRows) return;
        const timer = setTimeout(() => setHeld(false), SLIDE_MS + 50);
        return () => clearTimeout(timer);
    }, [hasRows]);

    if (!hasRows && !held) return null;

    const rows = (
        // only a row takes a touch, for its swipe. The space around the rows
        // passes every tap through to what is under it.
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <View
                pointerEvents="box-none"
                className="absolute right-4 items-end gap-2"
                style={{ top: insets.top + TOP_RAIL_HEIGHT + RAIL_GAP }}
            >
                {toasts.map((toast) => (
                    <Animated.View
                        key={toast.id}
                        entering={ENTERING}
                        exiting={EXITING}
                        layout={LAYOUT}
                    >
                        <SwipeToDismiss
                            onDismiss={() => dismissToast(toast.id)}
                        >
                            <ToastRow
                                toast={toast}
                                onDismiss={() => dismissToast(toast.id)}
                            />
                        </SwipeToDismiss>
                    </Animated.View>
                ))}
            </View>
        </View>
    );

    // iOS draws a native presentation above ordinary React siblings, so the
    // rows go to the window layer. Same reason `BottomBarsOverlay` does it.
    if (Platform.OS !== "ios") return rows;

    // the overlay is its own window, so gestures in it need their own root
    return (
        <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
            <GestureHandlerRootView
                pointerEvents="box-none"
                style={StyleSheet.absoluteFill}
            >
                {rows}
            </GestureHandlerRootView>
        </FullWindowOverlay>
    );
}

/**
 * Lets a row be dragged right and flung off. Its own view, inside the one
 * that slides the row out, so the slide out plays off screen where the fling
 * left it rather than snapping the row back first.
 */
function SwipeToDismiss({
    onDismiss,
    children,
}: {
    onDismiss: () => void;
    children: ReactNode;
}) {
    const { width } = useWindowDimensions();
    const offset = useSharedValue(0);

    const swipe = Gesture.Pan()
        .activeOffsetX(8)
        .failOffsetY([-12, 12])
        .onUpdate((event) => {
            offset.set(Math.max(0, event.translationX));
        })
        .onEnd((event) => {
            if (
                event.translationX > DISMISS_DRAG ||
                event.velocityX > DISMISS_VELOCITY
            ) {
                offset.set(
                    withTiming(
                        width,
                        { duration: SWIPE_SETTLE_MS },
                        (finished) => {
                            // not when a new drag caught it on the way out
                            if (finished) runOnJS(onDismiss)();
                        },
                    ),
                );
            } else {
                offset.set(withTiming(0, { duration: SWIPE_SETTLE_MS }));
            }
        });

    const style = useAnimatedStyle(() => ({
        transform: [{ translateX: offset.get() }],
    }));

    return (
        <GestureDetector gesture={swipe}>
            <Animated.View style={style}>{children}</Animated.View>
        </GestureDetector>
    );
}

/** One row: its icon, then its title over its message. */
function ToastRow({
    toast,
    onDismiss,
}: {
    toast: Toast;
    onDismiss: () => void;
}) {
    const { colors } = useAppTheme();
    const { icon, title } = toast;
    const outlined = shouldShowGlassOutline();
    const isError = icon === "error";
    const iconName: IconName =
        icon === "info" || icon === "success" || icon === "error"
            ? PRESET_ICONS[icon]
            : icon;
    const iconColor =
        icon === "success"
            ? colors.success
            : isError
              ? colors.destructive
              : colors.foreground;
    const radius = title ? CARD_RADIUS : PILL_RADIUS;
    const text = title ? `${title}. ${toast.message}` : toast.message;

    return (
        <View
            accessible
            accessibilityLabel={
                toast.running
                    ? text
                    : icon === "success"
                      ? `${text}, done`
                      : isError
                        ? `${text}, failed`
                        : text
            }
            // a screen reader cannot swipe it, so it gets the same as an action
            accessibilityActions={[{ name: "dismiss", label: "Dismiss" }]}
            onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === "dismiss") onDismiss();
            }}
            style={{ borderRadius: radius }}
            className={cn(
                "max-w-[280px] flex-row items-center gap-2 px-3 py-1.5 shadow-sm",
                title && "py-2",
                outlined && "border border-border",
            )}
        >
            {/* A background layer rather than a background color, so the row
                is translucent. It clips itself, which is why it cannot be the
                same view as the shadow above. */}
            <GlassSurface
                style={[
                    StyleSheet.absoluteFill,
                    { borderRadius: radius, overflow: "hidden" },
                ]}
            />
            <View
                className="items-center justify-center"
                style={{ width: ICON_BOX, height: ICON_BOX }}
            >
                <Ionicons name={iconName} size={ICON_SIZE} color={iconColor} />
            </View>
            <View className="shrink">
                {title ? (
                    <Text
                        className={cn(
                            "text-xs font-extrabold",
                            isError && "text-destructive",
                        )}
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                ) : null}
                {/* lighter under a title, so the title reads as the bold line */}
                <Text
                    className={cn(
                        "text-xs",
                        title ? "font-normal" : "font-medium",
                        isError && "text-destructive",
                    )}
                    numberOfLines={title ? 3 : 2}
                >
                    {toast.message}
                </Text>
            </View>
        </View>
    );
}
