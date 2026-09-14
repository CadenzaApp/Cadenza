import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter, useSegments } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import type { ComponentProps, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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
    TAB_BAR_MARGIN,
    useScreenOverlayInsets,
} from "@/lib/screen-overlay";

/**
 * The tabs, in bar order. The one place that order is written down: the bar is
 * mounted outside the navigator, so the navigator no longer decides it.
 */
export const TABS = [
    {
        segment: "social",
        href: "/social",
        icon: "people-sharp",
        label: "Social",
    },
    {
        segment: "analytics",
        href: "/analytics",
        icon: "stats-chart-sharp",
        label: "Analytics",
    },
    {
        segment: "cadenza",
        href: "/cadenza",
        icon: "musical-notes-sharp",
        label: "Cadenza",
    },
    {
        segment: "library",
        href: "/library",
        icon: "library-sharp",
        label: "Library",
    },
    {
        segment: "search",
        href: "/search",
        icon: "search-sharp",
        label: "Search",
    },
] as const satisfies readonly {
    segment: string;
    href: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    label: string;
}[];

const LAST_TAB_INDEX = TABS.length - 1;

/**
 * The bubble behind the selected tab. It shares its box with the docked player,
 * so its inset and height come from `screen-overlay` rather than from here.
 */
const PILL_INSET_X = 6;
const PILL_TOP = TAB_BAR_ITEM_INSET;
const PILL_HEIGHT = DOCKED_PLAYER_HEIGHT;
const PILL_RADIUS = 22;
const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;
/**
 * How far below center the icon and label sit. Each item is an icon stacked
 * over a label, so its visual weight is above its geometric middle and true
 * center still reads high.
 */
const TAB_ITEM_NUDGE = 3;

const SLIDE = { duration: 260, easing: Easing.out(Easing.cubic) };

/**
 * Where the selection currently sits, in tab index space. It is fractional
 * while the bubble slides, which is what lets an icon tint on the way past
 * rather than only once the slide lands.
 */
type TabSelection = {
    /** Fractional tab index, animated. */
    position: SharedValue<number>;
    /** The settled tab index, for anything that re-renders rather than animates. */
    index: number;
    /** The tab visited before the current one. */
    previousIndex: number;
    /** Points the selection at a tab index. The slide is the animation of it. */
    setIndex: (index: number) => void;
};

const TabSelectionContext = createContext<TabSelection | null>(null);

/**
 * Shares the selection position between the bar and anything else that reads
 * it. Mounted at the root, next to the player, because the bar is.
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
        () => ({
            position,
            index: selection.index,
            previousIndex: selection.previous,
            setIndex,
        }),
        [position, selection.index, selection.previous, setIndex],
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
 * Decides whether the bar renders at all. Nothing else. The counterpart to
 * `MediaPlayerHost`, and mounted beside it.
 */
export function TabBarHost() {
    const { bottomBarsVisible, bottomBarBottom } = useScreenOverlayInsets();
    if (!bottomBarsVisible) return null;
    return <TabBar bottom={bottomBarBottom} />;
}

/**
 * The floating tab bar. It is mounted outside the navigator, like the player,
 * so it survives navigation and can float over a pushed screen that is not a
 * tab at all. The navigator renders no bar of its own.
 *
 * Which tab is selected comes from the route segments rather than from
 * navigator state, for the same reason: there is no navigator above this.
 * Leaving the tabs for a detail screen leaves the selection where it was, which
 * is what you want to come back to.
 */
function TabBar({ bottom }: { bottom: number }) {
    const router = useRouter();
    const segments = useSegments();
    const { setIndex } = useTabSelection();
    const activeSegment = segments[0] === "(tabs)" ? segments[1] : undefined;

    useEffect(() => {
        const index = TABS.findIndex((tab) => tab.segment === activeSegment);
        if (index >= 0) setIndex(index);
    }, [activeSegment, setIndex]);

    return (
        <View
            pointerEvents="box-none"
            style={{
                position: "absolute",
                left: TAB_BAR_MARGIN,
                right: TAB_BAR_MARGIN,
                bottom,
                height: TAB_BAR_HEIGHT,
                borderRadius: TAB_BAR_RADIUS,
                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
            }}
        >
            <TabBarGlass />
            <View className="flex-1 flex-row">
                {TABS.map((tab, index) => (
                    <TabBarButton
                        key={tab.segment}
                        index={index}
                        label={tab.label}
                        icon={tab.icon}
                        // `navigate` rather than `push`: the tabs are already
                        // under whatever detail screen is open, so this pops
                        // back to them instead of stacking a second copy.
                        onPress={() => router.navigate(tab.href)}
                    />
                ))}
            </View>
        </View>
    );
}

/**
 * The bar's glass plus the bubble that slides between tabs. It sits behind the
 * items and is the one piece that measures the bar, which the docked player
 * needs to size itself to three slots.
 *
 * Items are equal width, so the bubble's x is just the index times one slot.
 */
function TabBarGlass() {
    const { position, index } = useTabSelection();
    const { progress, setBarMetrics, barWidth, tabCount } = usePlayerDock();
    const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;

    const bubbleStyle = useAnimatedStyle(() => {
        // Docked, the selected tab rides to the far left and the bubble goes
        // with it. Search is the exception: it keeps its slot, because it is
        // the tab the dock leaves reachable.
        const dockedIndex = index === LAST_TAB_INDEX ? LAST_TAB_INDEX : 0;
        const x = interpolate(
            progress.value,
            [0, 1],
            [position.value * slotWidth, dockedIndex * slotWidth],
        );
        return {
            transform: [{ translateX: x }],
        };
    });

    return (
        <View
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            onLayout={(event) =>
                setBarMetrics({
                    width: event.nativeEvent.layout.width,
                    tabCount: TABS.length,
                })
            }
        >
            <GlassSurface
                style={[
                    StyleSheet.absoluteFill,
                    {
                        borderRadius: TAB_BAR_RADIUS,
                        overflow: "hidden",
                    },
                ]}
            />
            {slotWidth > 0 ? (
                <Animated.View
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
            ) : null}
        </View>
    );
}

/**
 * Which tab rides to the far left while the player is docked. Normally the
 * selected one. On Search it is the tab you came from, unlit, because Search
 * is already holding the right slot and the left one would otherwise sit empty.
 */
function useDockedLeftIndex() {
    const { index, previousIndex } = useTabSelection();

    if (index !== LAST_TAB_INDEX) return index;
    // Nothing to come back from on a cold start into Search.
    return previousIndex === LAST_TAB_INDEX ? 0 : previousIndex;
}

/**
 * Where a tab sits while the player is docked, and whether it is there at all.
 * One tab slides to the far left, Search holds its slot on the right, and the
 * three in between fade out to leave room for the player.
 */
function useDockedTabStyle(index: number) {
    const { progress, barWidth, tabCount } = usePlayerDock();
    const leftIndex = useDockedLeftIndex();
    const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;
    const isLast = index === LAST_TAB_INDEX;
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

/**
 * One tab item, and the thing that moves while the player docks. The whole item
 * travels rather than just its icon, so the tab you can see is the tab you hit:
 * a transform moves the touch target with the pixels.
 *
 * A tab the docked player covers is faded out and disabled. An invisible tab
 * that still navigates is worse than no tab.
 */
function TabBarButton({
    index,
    icon,
    label,
    onPress,
}: {
    index: number;
    icon: ComponentProps<typeof Ionicons>["name"];
    label: string;
    onPress: () => void;
}) {
    const { docked } = usePlayerDock();
    const leftIndex = useDockedLeftIndex();
    const dockStyle = useDockedTabStyle(index);
    const covered = docked && index !== leftIndex && index !== LAST_TAB_INDEX;

    return (
        <Animated.View style={[{ flex: 1 }, dockStyle]}>
            <Pressable
                accessibilityRole="tab"
                accessibilityLabel={label}
                disabled={covered}
                onPress={onPress}
                // The bar packs its items to the top edge otherwise, which
                // leaves the icons crowding it. Center them, then nudge.
                className="flex-1 items-center justify-center"
                style={{ transform: [{ translateY: TAB_ITEM_NUDGE }] }}
            >
                <TabBarIcon index={index} name={icon} />
                <TabBarLabel index={index}>{label}</TabBarLabel>
            </Pressable>
        </Animated.View>
    );
}

/**
 * The tab icon in two stacked colors, the selected one fading in over the
 * unselected one. An icon takes its color from a prop rather than from a style,
 * so a crossfade is what stands in for interpolating it.
 *
 * Both layers are the same glyph on purpose. Fading between two different
 * glyphs shows one through the other for the whole slide, which reads as a
 * blink.
 */
function TabBarIcon({
    index,
    name,
    size = 24,
}: {
    index: number;
    name: ComponentProps<typeof Ionicons>["name"];
    size?: number;
}) {
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
function TabBarLabel({
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
