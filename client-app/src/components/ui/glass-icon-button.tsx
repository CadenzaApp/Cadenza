import type { ReactNode } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type PressableProps,
    type StyleProp,
    type ViewStyle,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { usePressedFill } from "@/components/ui/pressed-fill";
import { cn } from "@/lib/utils";

type GlassIconButtonProps = Omit<PressableProps, "children" | "style"> & {
    /** Diameter in points. The button is always a circle. */
    size?: number;
    surfaceScheme?: "light" | "dark";
    bordered?: boolean;
    className?: string;
    style?: StyleProp<ViewStyle>;
    children: ReactNode;
};

/**
 * A round icon button on glass.
 *
 * The pressable is the outermost element so it can carry `hitSlop`. Slop on an
 * inner view would do nothing, because the circle clips its bounds and a
 * clipping view never hit-tests outside them. The pressable also carries no
 * `className`: a nativewind class and a `style` function on the same element
 * fight, and the function loses, which kills the pressed state.
 *
 * Pressing it shrinks the circle and shades the glass until the finger lifts,
 * and `onPress` runs on the lift.
 *
 * Sizing, clipping, and centering live on the wrapper below it. The glass
 * carries its own radius rather than leaning on the wrapper's clip, which is
 * what the other glass surfaces in the app do and what Android needs.
 */
export function GlassIconButton({
    size = 40,
    surfaceScheme,
    bordered = true,
    className,
    style,
    children,
    ...rest
}: GlassIconButtonProps) {
    const radius = size / 2;

    const pressedFill = usePressedFill(surfaceScheme);

    return (
        <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={style}
            {...rest}
        >
            {({ pressed }) => (
                <View
                    className={cn(
                        bordered && "border border-border",
                        className,
                    )}
                    style={[
                        {
                            width: size,
                            height: size,
                            borderRadius: radius,
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                        },
                        pressed && styles.pressed,
                    ]}
                >
                    {/* The glass layer is a plain RN view away from the touch
                    path. `pointerEvents` on the glass itself goes to a native
                    view that may not honor it, and anything covering the
                    button that does honor it swallows the press. */}
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        <GlassSurface
                            colorScheme={surfaceScheme}
                            style={[
                                StyleSheet.absoluteFill,
                                // Inset the glass only when the wrapper has a border.
                                {
                                    borderRadius: radius - (bordered ? 1 : 0),
                                    overflow: "hidden",
                                },
                            ]}
                        />
                    </View>
                    {/* the press shows as a shade over the glass and a small
                    shrink: native glass does not fade with a faded parent, so
                    opacity alone barely shows */}
                    {pressed ? (
                        <View
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFill,
                                styles.pressedFill,
                                { backgroundColor: pressedFill },
                            ]}
                        />
                    ) : null}
                    <View style={pressed && styles.pressedContent}>
                        {children}
                    </View>
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pressed: { transform: [{ scale: 0.9 }] },
    pressedFill: { opacity: 0.18 },
    pressedContent: { opacity: 0.7 },
});
