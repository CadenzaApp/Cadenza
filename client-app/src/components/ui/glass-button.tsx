import type { ReactNode } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type ColorValue,
    type PressableProps,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { usePressedFill } from "@/components/ui/pressed-fill";
import { TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type GlassButtonVariant = "default" | "destructive";

type GlassButtonProps = Omit<PressableProps, "children" | "style"> & {
    variant?: GlassButtonVariant;
    className?: string;
    glassTintColor?: ColorValue;
    children: ReactNode;
};

/**
 * A full-size pressable whose visible surface is liquid glass. Pressing it
 * shrinks it a little and shades the glass until the finger lifts, and
 * `onPress` runs on the lift.
 */
export function GlassButton({
    variant = "default",
    className,
    glassTintColor,
    children,
    disabled,
    ...props
}: GlassButtonProps) {
    const destructive = variant === "destructive";
    const pressedFill = usePressedFill();

    return (
        <TextClassContext.Provider
            value={destructive ? "text-destructive" : "text-foreground"}
        >
            <Pressable
                accessibilityRole="button"
                disabled={disabled}
                {...props}
            >
                {({ pressed }) => (
                    <View
                        // never flattened away, pressed or not
                        collapsable={false}
                        className={cn(
                            "h-12 flex-row items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border px-4",
                            className,
                        )}
                        style={pressed && styles.pressed}
                    >
                        <View
                            pointerEvents="none"
                            style={StyleSheet.absoluteFill}
                        >
                            <GlassSurface
                                variant="regular"
                                tintColor={glassTintColor}
                                style={StyleSheet.absoluteFill}
                            />
                        </View>
                        {/* the press shows as a shade over the glass and a
                        small shrink: native glass does not fade with a faded
                        parent, so opacity alone barely shows. the shade and
                        the content's wrapper are always there, only their
                        opacity changes: a view that appears, or stops being
                        flattened, on press makes Android's mounting fail with
                        "the specified child already has a parent". disabled
                        dims the content, not the button, for the same reason */}
                        <View
                            pointerEvents="none"
                            style={[
                                StyleSheet.absoluteFill,
                                { backgroundColor: pressedFill },
                                pressed
                                    ? styles.pressedFill
                                    : styles.restingFill,
                            ]}
                        />
                        <View
                            collapsable={false}
                            className="flex-row items-center justify-center gap-2"
                            style={
                                disabled
                                    ? styles.disabled
                                    : pressed
                                      ? styles.pressedContent
                                      : styles.restingContent
                            }
                        >
                            {children}
                        </View>
                    </View>
                )}
            </Pressable>
        </TextClassContext.Provider>
    );
}

const styles = StyleSheet.create({
    disabled: { opacity: 0.4 },
    pressed: { transform: [{ scale: 0.96 }] },
    pressedFill: { opacity: 0.16 },
    restingFill: { opacity: 0 },
    pressedContent: { opacity: 0.75 },
    restingContent: { opacity: 1 },
});
