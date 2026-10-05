import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";

export type Segment<T extends string> = {
    value: T;
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
};

type Props<T extends string> = {
    segments: readonly Segment<T>[];
    selected: T;
    onSelect: (value: T) => void;
    /** The selected segment's color. The theme's text color when null. */
    accent: string | null;
};

const PADDING = 4;
const RADIUS = 18;
/** Eased, not sprung: a spring overshoots a target this small and wobbles. */
const SLIDE = { duration: 220, easing: Easing.out(Easing.cubic) };

/**
 * A small tab bar: equal segments, each an icon over a label, with a pill that
 * slides to the selected one. Glass paints the track and the pill, the same
 * way the search scope toggle does it. For a picker with a handful of fixed options,
 * where chips wrap and read as filters rather than places.
 */
export function SegmentedBar<T extends string>({
    segments,
    selected,
    onSelect,
    accent,
}: Props<T>) {
    const { colors } = useTheme();
    const [width, setWidth] = useState(0);
    const segmentWidth =
        segments.length > 0 ? (width - PADDING * 2) / segments.length : 0;
    const index = Math.max(
        0,
        segments.findIndex((segment) => segment.value === selected),
    );
    const offset = useSharedValue(0);

    useEffect(() => {
        offset.set(withTiming(index * segmentWidth, SLIDE));
    }, [index, offset, segmentWidth]);

    const pillStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: offset.get() }],
    }));

    return (
        <View
            accessibilityRole="tablist"
            className="flex-row overflow-hidden"
            style={{ padding: PADDING, borderRadius: RADIUS }}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="clear"
                    style={[StyleSheet.absoluteFill, { borderRadius: RADIUS }]}
                />
            </View>
            {/* drawn once measured, so it never flashes at the wrong size */}
            {segmentWidth > 0 ? (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        {
                            position: "absolute",
                            top: PADDING,
                            bottom: PADDING,
                            left: PADDING,
                            width: segmentWidth,
                        },
                        pillStyle,
                    ]}
                >
                    <GlassSurface
                        style={{
                            flex: 1,
                            borderRadius: RADIUS - PADDING,
                            borderCurve: "continuous",
                            overflow: "hidden",
                        }}
                    />
                </Animated.View>
            ) : null}
            {segments.map((segment) => {
                const isSelected = segment.value === selected;
                const color = isSelected
                    ? (accent ?? colors.text)
                    : colors.text;
                return (
                    <Pressable
                        key={segment.value}
                        onPress={() => onSelect(segment.value)}
                        accessibilityRole="tab"
                        accessibilityLabel={segment.label}
                        accessibilityState={{ selected: isSelected }}
                        className="flex-1 items-center gap-0.5 py-1.5"
                        style={{ opacity: isSelected ? 1 : 0.55 }}
                    >
                        <Ionicons name={segment.icon} size={18} color={color} />
                        <Text
                            className="text-[11px] font-medium"
                            style={{ color }}
                            numberOfLines={1}
                        >
                            {segment.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
