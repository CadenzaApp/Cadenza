import { useTheme } from "expo-router/react-navigation";
import { Pressable, StyleSheet, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";

/** An on/off switch painted on glass. The track tints when it is on. */
export function GlassToggle({
    value,
    onValueChange,
    accessibilityLabel,
}: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    accessibilityLabel: string;
}) {
    const { colors } = useTheme();

    return (
        <Pressable
            accessibilityRole="switch"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ checked: value }}
            onPress={() => onValueChange(!value)}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
        >
            <View
                className="overflow-hidden border border-border"
                style={{ width: 52, height: 32, borderRadius: 16 }}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        tintColor={value ? colors.notification : undefined}
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                <View
                    className="absolute top-[2px] h-[26px] w-[26px] rounded-full bg-white shadow-sm"
                    style={{ left: value ? 22 : 2 }}
                />
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.65 },
});
