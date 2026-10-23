import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import { Pressable, StyleSheet, View } from "react-native";

/** The circle behind the X, which the press fills. */
const SIZE = 32;

/**
 * The X in a popup's top right corner. Pressing it fills a circle behind it
 * and brightens it until the finger lifts, and `onPress` runs on the lift.
 *
 * Styled with `style` alone: a nativewind class and a `style` function on one
 * pressable fight, and the function loses, which kills the pressed state.
 */
export function DialogCloseButton({
    onPress,
    accessibilityLabel,
}: {
    onPress: () => void;
    accessibilityLabel: string;
}) {
    const { colors } = useTheme();

    return (
        <Pressable
            onPress={onPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
            {({ pressed }) => (
                <>
                    {pressed ? (
                        <View
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFill,
                                styles.fill,
                                { backgroundColor: colors.text },
                            ]}
                        />
                    ) : null}
                    <Ionicons
                        name="close"
                        size={18}
                        color={colors.text}
                        style={{ opacity: pressed ? 1 : 0.7 }}
                    />
                </>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    // centered where the bare 18 point X used to sit, 16 in from the corner
    button: {
        position: "absolute",
        top: 16 - (SIZE - 18) / 2,
        right: 16 - (SIZE - 18) / 2,
        zIndex: 10,
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    pressed: { transform: [{ scale: 0.92 }] },
    fill: { opacity: 0.14 },
});
