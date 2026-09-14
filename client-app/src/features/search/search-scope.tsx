import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
    Easing,
    useAnimatedStyle,
    useDerivedValue,
    withTiming,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/ui/glass-surface";
import { Text } from "@/components/ui/text";
import { TAB_BAR_ITEM_INSET } from "@/lib/screen-overlay";

/** Which library a search reads from. */
export type SearchScope = "catalog" | "library";

const OPTIONS: { scope: SearchScope; label: string }[] = [
    { scope: "catalog", label: "Apple Music" },
    { scope: "library", label: "Library" },
];

const TOGGLE_HEIGHT = 38;
const PILL_HEIGHT = TOGGLE_HEIGHT - TAB_BAR_ITEM_INSET * 2;
const SLIDE = { duration: 220, easing: Easing.out(Easing.cubic) };

type Props = {
    scope: SearchScope;
    onChange: (scope: SearchScope) => void;
};

/**
 * The Apple Music / Library switch above the results. Same construction as the
 * tab bar: glass for the track, a second piece of glass for the selection, and
 * the selection slides between the halves. It shares the bar's item inset so
 * the two pills read as the same thickness.
 */
export function SearchScopeToggle({ scope, onChange }: Props) {
    const [width, setWidth] = useState(0);
    const selected = OPTIONS.findIndex((option) => option.scope === scope);
    const position = useDerivedValue(
        () => withTiming(selected, SLIDE),
        [selected],
    );
    const halfWidth = width / 2;

    const pillStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: position.value * halfWidth }],
        opacity: width > 0 ? 1 : 0,
    }));

    return (
        <View className="px-5">
            <View
                className="overflow-hidden"
                style={{
                    height: TOGGLE_HEIGHT,
                    borderRadius: TOGGLE_HEIGHT / 2,
                }}
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        style={[
                            StyleSheet.absoluteFill,
                            { borderRadius: TOGGLE_HEIGHT / 2 },
                        ]}
                    />
                </View>

                <Animated.View
                    pointerEvents="none"
                    style={[
                        {
                            position: "absolute",
                            top: TAB_BAR_ITEM_INSET,
                            left: TAB_BAR_ITEM_INSET,
                            width: Math.max(
                                0,
                                halfWidth - TAB_BAR_ITEM_INSET * 2,
                            ),
                            height: PILL_HEIGHT,
                        },
                        pillStyle,
                    ]}
                >
                    <GlassSurface
                        style={{
                            flex: 1,
                            borderRadius: PILL_HEIGHT / 2,
                            borderCurve: "continuous",
                            overflow: "hidden",
                        }}
                    />
                </Animated.View>

                <View className="flex-1 flex-row">
                    {OPTIONS.map((option) => (
                        <Pressable
                            key={option.scope}
                            accessibilityRole="button"
                            accessibilityState={{
                                selected: option.scope === scope,
                            }}
                            onPress={() => onChange(option.scope)}
                            className="flex-1 items-center justify-center active:opacity-70"
                        >
                            <Text
                                className={
                                    option.scope === scope
                                        ? "text-sm font-semibold"
                                        : "text-sm font-medium text-muted-foreground"
                                }
                            >
                                {option.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </View>
        </View>
    );
}
