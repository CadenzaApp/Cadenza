import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/** The circle behind the X, which the press fills. */
const SIZE = 32;

/**
 * The X in a popup's top right corner. Pressing it fills a circle behind it
 * and brightens it until the finger lifts, and `onPress` runs on the lift.
 *
 * `style` is a plain object. NativeWind maps `className` onto `style` and
 * drops a style function, which left this button stretched across the row.
 */
export function DialogCloseButton({
    onPress,
    accessibilityLabel,
}: {
    onPress: () => void;
    accessibilityLabel: string;
}) {
    const { colors } = useTheme();
    const [pressed, setPressed] = useState(false);

    return (
        <View pointerEvents="box-none" style={styles.slot}>
            <Pressable
                onPress={onPress}
                onPressIn={() => setPressed(true)}
                onPressOut={() => setPressed(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                style={[styles.button, pressed ? styles.pressed : null]}
            >
                {/* always there, only its opacity changes: a view that
                    appears on press makes Android's mounting fail with
                    "the specified child already has a parent" */}
                <View
                    pointerEvents="none"
                    style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: colors.text },
                        pressed ? styles.fill : styles.restingFill,
                    ]}
                />
                <Ionicons
                    name="close"
                    size={18}
                    color={colors.text}
                    style={{ opacity: pressed ? 1 : 0.7 }}
                />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    // The slot is the hit box. NativeWind drops a Pressable style function,
    // and a bare Pressable in this column then stretches across the row.
    slot: {
        position: "absolute",
        top: 16 - (SIZE - 18) / 2,
        right: 16 - (SIZE - 18) / 2,
        zIndex: 10,
        width: SIZE,
        height: SIZE,
    },
    button: {
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    pressed: { transform: [{ scale: 0.92 }] },
    fill: { opacity: 0.14 },
    restingFill: { opacity: 0 },
});
