import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigationState, useTheme } from "expo-router/react-navigation";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableProps } from "react-native";
import Animated, {
    Easing,
    interpolate,
    interpolateColor,
    useAnimatedStyle,
    useDerivedValue,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { usePlayerDock } from "@/lib/player-dock";
import {
    DOCKED_PLAYER_HEIGHT,
    TAB_BAR_HEIGHT,
    TAB_BAR_ITEM_INSET,
} from "@/lib/screen-overlay";

/**
 * The bubble behind the selected tab. It shares its box with the docked player,
 * so its inset and height come from `screen-overlay` rather than from here.
 */
const PILL_INSET_X = 6;
const PILL_TOP = TAB_BAR_ITEM_INSET;
const PILL_HEIGHT = DOCKED_PLAYER_HEIGHT;
const PILL_RADIUS = 22;

const SLIDE = { duration: 260, easing: Easing.out(Easing.cubic) };

/**
 * Where the selection currently sits, in tab index space. It is fractional
 * while the bubble slides, which is what lets an icon tint on the way past
 * rather than only once the slide lands.
 */
type TabSelection = {
    /** Fractional tab index, animated. */
    position: SharedValue<number>;
    /** The tab visited before the current one. */
    previousIndex: number;
    /** Points the selection at a tab index. The slide is the animation of it. */
    setIndex: (index: number) => void;
};

const TabSelectionContext = createContext<TabSelection | null>(null);

/**
 * Shares the selection position between the bar background, which draws the
 * bubble, and the items, which tint off it. Wrap the navigator in it.
 */
export function TabSelectionProvider({ children }: { children: ReactNode }) {
    // The tab you came from is kept because the docked bar needs a tab for its
    // left slot, and on Search the selected tab is already holding the right.
    const [selection, setSelection] = useState({ index: 0, previous: 0 });
    const setIndex = useCallback((next: number) => {
        setSelection((current) =>
            current.index === next
                ? current
                : { index: next, previous: current.index },
        );
    }, []);
    // Derived rather than assigned, so the slide is a consequence of the
    // selected index rather than something a caller has to remember to run.
    const position = useDerivedValue(
        () => withTiming(selection.index, SLIDE),
        [selection.index],
    );

    const value = useMemo(
        () => ({ position, previousIndex: selection.previous, setIndex }),
        [position, selection.previous, setIndex],
    );

    return (
        <TabSelectionContext.Provider value={value}>
            {children}
        </TabSelectionContext.Provider>
    );
}

function useTabSelection() {
    const selection = useContext(TabSelectionContext);
    if (!selection) {
        throw new Error(
            "Tab bar pieces must render inside TabSelectionProvider",
        );
    }
    return selection;
}

/**
 * The bar's glass plus the bubble that slides between tabs. This is the tab
 * bar's `tabBarBackground`, so it sits behind the items, and it is the one
 * piece that drives the selection position.
 *
 * Items are equal width, so the bubble's x is just the index times one slot.
 */
export function TabBarGlass() {
    const { position, setIndex } = useTabSelection();
    const { progress, setBarMetrics, barWidth, tabCount } = usePlayerDock();
    const index = useNavigationState((state) => state.index);
    const routeCount = useNavigationState((state) => state.routes.length);
    const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;

    useEffect(() => {
        setIndex(index);
    }, [index, setIndex]);

    const bubbleStyle = useAnimatedStyle(() => {
        // Docked, the selected tab rides to the far left and the bubble goes
        // with it. Search is the exception: it keeps its slot, because it is
        // the tab the dock leaves reachable.
        const dockedIndex = index === routeCount - 1 ? routeCount - 1 : 0;
        const x = interpolate(
            progress.value,
            [0, 1],
            [position.value * slotWidth, dockedIndex * slotWidth],
        );
        return {
            transform: [{ translateX: x }],
            // Nothing to place until the bar has been measured.
            opacity: slotWidth > 0 ? 1 : 0,
        };
    });

    return (
        <View
            style={StyleSheet.absoluteFill}
            onLayout={(event) =>
                setBarMetrics({
                    width: event.nativeEvent.layout.width,
                    tabCount: routeCount,
                })
            }
        >
            <GlassSurface
                style={[
                    StyleSheet.absoluteFill,
                    {
                        borderRadius: TAB_BAR_HEIGHT / 2,
                        overflow: "hidden",
                    },
                ]}
            />
            <Animated.View
                pointerEvents="none"
                style={[
                    {
                        position: "absolute",
                        top: PILL_TOP,
                        left: 0,
                        width: slotWidth,
                        height: PILL_HEIGHT,
                        paddingHorizontal: PILL_INSET_X,
                    },
                    bubbleStyle,
                ]}
            >
                <GlassSurface
                    style={{
                        flex: 1,
                        borderRadius: PILL_RADIUS,
                        borderCurve: "continuous",
                        overflow: "hidden",
                    }}
                />
            </Animated.View>
        </View>
    );
}

/**
 * Which tab rides to the far left while the player is docked. Normally the
 * selected one. On Search it is the tab you came from, unlit, because Search
 * is already holding the right slot and the left one would otherwise sit empty.
 */
function useDockedLeftIndex() {
    const { previousIndex } = useTabSelection();
    const activeIndex = useNavigationState((state) => state.index);
    const lastIndex = useNavigationState((state) => state.routes.length - 1);

    if (activeIndex !== lastIndex) return activeIndex;
    // Nothing to come back from on a cold start into Search.
    return previousIndex === lastIndex ? 0 : previousIndex;
}

/**
 * Where a tab sits while the player is docked, and whether it is there at all.
 * One tab slides to the far left, Search holds its slot on the right, and the
 * three in between fade out to leave room for the player.
 */
function useDockedTabStyle(index: number) {
    const { progress, barWidth, tabCount } = usePlayerDock();
    const lastIndex = useNavigationState((state) => state.routes.length - 1);
    const leftIndex = useDockedLeftIndex();
    const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;
    const isLast = index === lastIndex;
    const isLeft = index === leftIndex;

    return useAnimatedStyle(() => ({
        transform: [
            {
                translateX:
                    isLeft && !isLast ? -index * slotWidth * progress.value : 0,
            },
        ],
        opacity: isLeft || isLast ? 1 : 1 - progress.value,
    }));
}

/**
 * How lit this tab is, 0 to 1, from how close the bubble is to it. Tabs the
 * bubble passes over light up part way, so the slide carries the color with it.
 */
function useTabProximity(index: number) {
    const { position } = useTabSelection();
    return useDerivedValue(() =>
        interpolate(Math.abs(position.value - index), [0, 1], [1, 0], "clamp"),
    );
}

type TabBarIconProps = {
    index: number;
    name: ComponentProps<typeof Ionicons>["name"];
    size?: number;
};

/**
 * The tab icon in two stacked colors, the selected one fading in over the
 * unselected one. An icon takes its color from a prop rather than from a style,
 * so a crossfade is what stands in for interpolating it.
 *
 * Both layers are the same glyph on purpose. Fading between two different
 * glyphs shows one through the other for the whole slide, which reads as a
 * blink.
 */
export function TabBarIcon({ index, name, size = 24 }: TabBarIconProps) {
    const { colors } = useTheme();
    const lit = useTabProximity(index);
    const unlitStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));
    const litStyle = useAnimatedStyle(() => ({ opacity: lit.value }));

    return (
        <View>
            <Animated.View style={unlitStyle}>
                <Ionicons name={name} color={colors.text} size={size} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, litStyle]}>
                <Ionicons name={name} color={colors.notification} size={size} />
            </Animated.View>
        </View>
    );
}

/**
 * The tab label, tinted off the same position as the icon. Color is a style
 * here, so it can be interpolated rather than crossfaded.
 */
export function TabBarLabel({
    index,
    children,
}: {
    index: number;
    children: ReactNode;
}) {
    const { colors } = useTheme();
    const lit = useTabProximity(index);
    const tintStyle = useAnimatedStyle(() => ({
        color: interpolateColor(
            lit.value,
            [0, 1],
            // The theme types colors as ColorValue; reanimated wants strings.
            [String(colors.text), String(colors.notification)],
        ),
    }));

    return (
        <Animated.Text style={[{ fontSize: 10 }, tintStyle]}>
            {children}
        </Animated.Text>
    );
}

type TabBarButtonProps = Omit<PressableProps, "children"> & {
    children?: ReactNode;
    "aria-selected"?: boolean;
};

/**
 * One tab item, and the thing that moves while the player docks. The whole item
 * travels rather than just its icon, so the tab you can see is the tab you hit:
 * a transform moves the touch target with the pixels.
 *
 * A tab the docked player covers is faded out and disabled. An invisible tab
 * that still navigates is worse than no tab.
 */
export function TabBarButton({
    index,
    children,
    ...props
}: TabBarButtonProps & { index: number }) {
    const { docked } = usePlayerDock();
    const lastIndex = useNavigationState((state) => state.routes.length - 1);
    const leftIndex = useDockedLeftIndex();
    const dockStyle = useDockedTabStyle(index);
    const covered = docked && index !== leftIndex && index !== lastIndex;

    return (
        <Animated.View style={[{ flex: 1 }, dockStyle]}>
            <Pressable {...props} disabled={covered}>
                {children}
            </Pressable>
        </Animated.View>
    );
}
