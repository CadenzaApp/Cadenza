import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
    interpolate,
    interpolateColor,
    useAnimatedStyle,
    useDerivedValue,
    type SharedValue,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";

const BAR_HEIGHT = 56;
const BAR_RADIUS = BAR_HEIGHT / 2;
const PILL_INSET = 4;
const PILL_RADIUS = BAR_RADIUS - PILL_INSET;
/** Icon sits above the label, so true center reads a touch high. */
const ITEM_NUDGE = 2;

const SEGMENTS = [
    { key: "comments", label: "Comments", icon: "chatbubble-ellipses-sharp" },
    { key: "player", label: "Player", icon: "musical-notes-sharp" },
    { key: "tags", label: "Tags", icon: "pricetags-sharp" },
] as const satisfies readonly {
    key: string;
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
}[];

export type PlayerPageKey = (typeof SEGMENTS)[number]["key"];
export const PLAYER_PAGE_KEYS: PlayerPageKey[] = SEGMENTS.map(
    (segment) => segment.key,
);

/**
 * The now-playing sheet's own bottom bar: Comments, Player, Tags. Same glass
 * pill, sliding-highlight, and icon/label treatment as the app's main
 * `TabBar` (`@/components/custom/tab-bar`), just three static segments
 * instead of the app's tabs, and driven by the pager's own swipe position
 * rather than a route.
 */
export function MiniTabBar({
    position,
    onSelect,
}: {
    /** Fractional page index (0..2), animated by the pager's swipe. */
    position: SharedValue<number>;
    onSelect: (index: number) => void;
}) {
    const [barWidth, setBarWidth] = useState(0);
    const slotWidth = barWidth / SEGMENTS.length;

    const bubbleStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: position.value * slotWidth }],
    }));

    return (
        <View
            onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
            style={{
                height: BAR_HEIGHT,
                borderRadius: BAR_RADIUS,
                overflow: "hidden",
                shadowColor: "#000",
                shadowOpacity: 0.18,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
            }}
        >
            <GlassSurface style={StyleSheet.absoluteFill} />

            {slotWidth > 0 ? (
                <Animated.View
                    style={[
                        {
                            position: "absolute",
                            top: PILL_INSET,
                            bottom: PILL_INSET,
                            left: 0,
                            width: slotWidth,
                            paddingHorizontal: PILL_INSET,
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

            <View className="flex-1 flex-row">
                {SEGMENTS.map((segment, index) => (
                    <Pressable
                        key={segment.key}
                        accessibilityRole="tab"
                        accessibilityLabel={segment.label}
                        onPress={() => onSelect(index)}
                        className="flex-1 items-center justify-center"
                        style={{ transform: [{ translateY: ITEM_NUDGE }] }}
                    >
                        <SegmentIcon
                            index={index}
                            position={position}
                            name={segment.icon}
                        />
                        <SegmentLabel
                            index={index}
                            position={position}
                            label={segment.label}
                        />
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

/** How lit this segment is, 0 to 1, from how close the bubble is to it. */
function useSegmentProximity(index: number, position: SharedValue<number>) {
    return useDerivedValue(() =>
        interpolate(Math.abs(position.value - index), [0, 1], [1, 0], "clamp"),
    );
}

/**
 * The segment icon in two stacked colors, the selected one fading in over the
 * unselected one - same crossfade `TabBarIcon` uses, since an icon takes its
 * color from a prop rather than a style.
 */
function SegmentIcon({
    index,
    position,
    name,
    size = 18,
}: {
    index: number;
    position: SharedValue<number>;
    name: ComponentProps<typeof Ionicons>["name"];
    size?: number;
}) {
    const { colors } = useTheme();
    const lit = useSegmentProximity(index, position);
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

/** The segment label, tinted by how close the bubble has slid to it. */
function SegmentLabel({
    index,
    position,
    label,
}: {
    index: number;
    position: SharedValue<number>;
    label: string;
}) {
    const { colors } = useTheme();
    const lit = useSegmentProximity(index, position);
    const tintStyle = useAnimatedStyle(() => ({
        color: interpolateColor(
            lit.value,
            [0, 1],
            [String(colors.text), String(colors.notification)],
        ),
    }));

    return (
        <Animated.Text style={[{ fontSize: 10, fontWeight: "600" }, tintStyle]}>
            {label}
        </Animated.Text>
    );
}
