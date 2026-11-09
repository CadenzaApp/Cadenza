import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, type ComponentProps } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type GlassInputProps = ComponentProps<typeof TextInput> & {
    /** Drawn before the text, muted. */
    icon?: IoniconName;
    /** Classes for the glass field around the input. */
    containerClassName?: string;
};

/**
 * A text field on glass, the same height and radius as `GlassButton` so a
 * form of fields and a button lines up. Dimmed while not editable.
 */
export const GlassInput = forwardRef<TextInput, GlassInputProps>(
    function GlassInput(
        { icon, containerClassName, className, editable, ...props },
        ref,
    ) {
        const { colors } = useAppTheme();

        return (
            <View
                className={cn(
                    "h-12 flex-row items-center gap-2.5 overflow-hidden rounded-2xl border border-border px-4",
                    editable === false && "opacity-50",
                    containerClassName,
                )}
            >
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="regular"
                        style={StyleSheet.absoluteFill}
                    />
                </View>
                {icon ? (
                    <Ionicons
                        name={icon}
                        size={18}
                        color={colors.mutedForeground}
                    />
                ) : null}
                <TextInput
                    ref={ref}
                    editable={editable}
                    placeholderTextColor={colors.mutedForeground}
                    className={cn("h-full flex-1 text-foreground", className)}
                    // font size only: a line height on a single line iOS
                    // field draws the text off center (secure fields hide it)
                    style={styles.text}
                    {...props}
                />
            </View>
        );
    },
);

const styles = StyleSheet.create({
    text: { fontSize: 16, paddingVertical: 0, textAlignVertical: "center" },
});
