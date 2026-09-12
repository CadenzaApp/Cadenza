import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type PressableProps } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { cn } from "@/lib/utils";

type GlassIconButtonProps = Omit<PressableProps, "children" | "style"> & {
    /** Diameter in points. The button is always a circle. */
    size?: number;
    className?: string;
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
 * Sizing, clipping, and centering live on the wrapper below it. The glass
 * carries its own radius rather than leaning on the wrapper's clip, which is
 * what the other glass surfaces in the app do and what Android needs.
 */
export function GlassIconButton({
    size = 40,
    className,
    children,
    ...rest
}: GlassIconButtonProps) {
    const radius = size / 2;

    return (
        <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
            {...rest}
        >
            <View
                className={cn("border border-border", className)}
                style={{
                    width: size,
                    height: size,
                    borderRadius: radius,
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                }}
            >
                {/* The glass layer is a plain RN view away from the touch
                    path. `pointerEvents` on the glass itself goes to a native
                    view that may not honor it, and anything covering the
                    button that does honor it swallows the press. */}
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        style={[
                            StyleSheet.absoluteFill,
                            // Absolute children sit inside the border, so the
                            // glass is a point smaller on every side.
                            { borderRadius: radius - 1, overflow: "hidden" },
                        ]}
                    />
                </View>
                {children}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.65 },
});
