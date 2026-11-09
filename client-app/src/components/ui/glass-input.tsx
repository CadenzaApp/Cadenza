import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef, useState, type ComponentProps } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

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
 *
 * The placeholder is drawn here, not by the native field: iOS draws a secure
 * field's placeholder off center, so a password field would not match the
 * one above it. A flexbox centered label sits the same in every field.
 */
export const GlassInput = forwardRef<TextInput, GlassInputProps>(
    function GlassInput(
        {
            icon,
            containerClassName,
            className,
            editable,
            placeholder,
            onChangeText,
            ...props
        },
        ref,
    ) {
        const { colors } = useAppTheme();
        // an uncontrolled field still needs to know when it is empty
        const [typed, setTyped] = useState(props.defaultValue ?? "");
        const text = props.value ?? typed;

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
                <View className="h-full flex-1 justify-center">
                    {placeholder && text.length === 0 ? (
                        <View
                            pointerEvents="none"
                            className="absolute inset-0 justify-center"
                        >
                            <Text
                                numberOfLines={1}
                                style={[
                                    styles.text,
                                    { color: colors.mutedForeground },
                                ]}
                            >
                                {placeholder}
                            </Text>
                        </View>
                    ) : null}
                    <TextInput
                        ref={ref}
                        editable={editable}
                        accessibilityLabel={placeholder}
                        onChangeText={(next) => {
                            setTyped(next);
                            onChangeText?.(next);
                        }}
                        className={cn("h-full text-foreground", className)}
                        // font size only: a line height on a single line iOS
                        // field draws the text off center
                        style={styles.text}
                        {...props}
                    />
                </View>
            </View>
        );
    },
);

const styles = StyleSheet.create({
    text: {
        fontSize: 16,
        paddingVertical: 0,
        paddingHorizontal: 0,
        textAlignVertical: "center",
    },
});
