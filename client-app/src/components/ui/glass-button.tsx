import type { ReactNode } from "react";
import {
    Pressable,
    StyleSheet,
    View,
    type ColorValue,
    type PressableProps,
} from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { TextClassContext } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type GlassButtonVariant = "default" | "destructive";

type GlassButtonProps = Omit<PressableProps, "children" | "style"> & {
    variant?: GlassButtonVariant;
    className?: string;
    glassTintColor?: ColorValue;
    children: ReactNode;
};

/** A full-size pressable whose visible surface is liquid glass. */
export function GlassButton({
    variant = "default",
    className,
    glassTintColor,
    children,
    disabled,
    ...props
}: GlassButtonProps) {
    const destructive = variant === "destructive";

    return (
        <TextClassContext.Provider
            value={destructive ? "text-destructive" : "text-foreground"}
        >
            <Pressable
                accessibilityRole="button"
                disabled={disabled}
                style={({ pressed }) => pressed && styles.pressed}
                {...props}
            >
                <View
                    className={cn(
                        "h-12 flex-row items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border px-4",
                        className,
                    )}
                >
                    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                        <GlassSurface
                            variant="regular"
                            tintColor={glassTintColor}
                            style={StyleSheet.absoluteFill}
                        />
                    </View>
                    {/* disabled dims the content, not the button: native glass
                        under a faded parent does not fade with it */}
                    <View
                        className="flex-row items-center justify-center gap-2"
                        style={disabled && styles.disabled}
                    >
                        {children}
                    </View>
                </View>
            </Pressable>
        </TextClassContext.Provider>
    );
}

const styles = StyleSheet.create({
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.65 },
});
