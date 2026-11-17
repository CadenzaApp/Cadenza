import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { usePressedFill } from "@/components/ui/pressed-fill";

export type GlassIconGroupItem = {
    icon: IoniconName;
    accessibilityLabel: string;
    onPress: () => void;
};

/** Height, and the width each icon gets. Matches `GlassIconButton`. */
const SIZE = 40;
/** How much of the pressed fill shows over the glass. */
const PRESSED_SHADE = 0.18;
/** Extra room per icon in a group of two or more, like Apple Music's pair. */
const GROUP_ITEM_WIDTH = 48;

/**
 * Icon buttons sharing one glass capsule, like the + and filter pair at the
 * top of Apple Music's lists. One item is a plain circle. Each icon presses
 * on its own, shading only its half.
 */
export function GlassIconGroup({ items }: { items: GlassIconGroupItem[] }) {
    const { colors } = useTheme();
    const pressedFill = usePressedFill();
    const itemWidth = items.length > 1 ? GROUP_ITEM_WIDTH : SIZE;

    return (
        <View
            className="flex-row overflow-hidden border border-border"
            style={{
                height: SIZE,
                width: itemWidth * items.length,
                borderRadius: SIZE / 2,
            }}
        >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    style={[
                        StyleSheet.absoluteFill,
                        { borderRadius: SIZE / 2 - 1, overflow: "hidden" },
                    ]}
                />
            </View>
            {items.map((item) => (
                <Pressable
                    key={item.accessibilityLabel}
                    accessibilityRole="button"
                    accessibilityLabel={item.accessibilityLabel}
                    onPress={item.onPress}
                    hitSlop={{ top: 8, bottom: 8 }}
                    style={[styles.item, { width: itemWidth }]}
                >
                    {({ pressed }) => (
                        <>
                            {/* the same shade a pressed GlassIconButton
                                shows, always there so only opacity changes */}
                            <View
                                pointerEvents="none"
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        backgroundColor: pressedFill,
                                        opacity: pressed ? PRESSED_SHADE : 0,
                                    },
                                ]}
                            />
                            <Ionicons
                                name={item.icon}
                                size={22}
                                color={colors.text}
                                style={{ opacity: pressed ? 0.7 : 1 }}
                            />
                        </>
                    )}
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    item: { height: "100%", alignItems: "center", justifyContent: "center" },
});
