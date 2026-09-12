import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigationState, useTheme } from "expo-router/react-navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { StyleSheet, View } from "react-native";
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
import { TAB_BAR_HEIGHT } from "@/lib/screen-overlay";

/** The bubble behind the selected tab, measured from the top of the bar. */
const PILL_INSET_X = 6;
const PILL_TOP = 3;
const PILL_HEIGHT = 54;
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
    /** Points the selection at a tab index. The slide is the animation of it. */
    setIndex: (index: number) => void;
};

const TabSelectionContext = createContext<TabSelection | null>(null);

/**
 * Shares the selection position between the bar background, which draws the
 * bubble, and the items, which tint off it. Wrap the navigator in it.
 */
export function TabSelectionProvider({ children }: { children: ReactNode }) {
    const [index, setIndex] = useState(0);
    // Derived rather than assigned, so the slide is a consequence of the
    // selected index rather than something a caller has to remember to run.
    const position = useDerivedValue(() => withTiming(index, SLIDE), [index]);

    return (
        <TabSelectionContext.Provider value={{ position, setIndex }}>
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
    const index = useNavigationState((state) => state.index);
    const tabCount = useNavigationState((state) => state.routes.length);
    const [barWidth, setBarWidth] = useState(0);
    const slotWidth = tabCount > 0 ? barWidth / tabCount : 0;

    useEffect(() => {
        setIndex(index);
    }, [index, setIndex]);

    const bubbleStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: position.value * slotWidth }],
        // Nothing to place until the bar has been measured.
        opacity: slotWidth > 0 ? 1 : 0,
    }));

    return (
        <View
            style={StyleSheet.absoluteFill}
            onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
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
