import Ionicons from "@expo/vector-icons/Ionicons";
import { forwardRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { withAlpha } from "@/lib/artwork-color";
import { useAppTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Height, text size, and icon size per `size`. */
const SIZES = {
    md: { height: 44, fontSize: 16, icon: 17 },
    sm: { height: 36, fontSize: 14, icon: 15 },
} as const;

export type SearchFieldSize = keyof typeof SIZES;
/**
 * `glass` is a pill of clear glass, for a field on the page itself. `outline`
 * is a hairline ring with no fill, for a field already on a glass panel or a
 * popup, where more glass would stack.
 */
export type SearchFieldSurface = "glass" | "outline";

type Props = {
    value: string;
    onChangeText: (text: string) => void;
    placeholder: string;
    onSubmit?: () => void;
    onFocus?: () => void;
    /** Defaults to emptying the text. */
    onClear?: () => void;
    /** Defaults to `md`. */
    size?: SearchFieldSize;
    /** Defaults to `glass`. */
    surface?: SearchFieldSurface;
    editable?: boolean;
    autoFocus?: boolean;
    /** Defaults to the placeholder. */
    accessibilityLabel?: string;
    /** Classes for the pill, like `flex-1` in a row. */
    className?: string;
};

/**
 * The one search bar. Every search in the app is this, with its own
 * placeholder and handlers; `size` and `surface` fit it to where it sits.
 *
 * Text centering: the input has a font size and nothing else, no line height
 * and no vertical padding, and fills the pill's height, so iOS centers the
 * text in it itself. The placeholder is drawn here rather than by the native
 * field, centered by flexbox, so it sits exactly where typed text does.
 *
 * The glass is an absolutely positioned layer behind the content, the way
 * `GlassIconButton` does it: a native glass view given children and no size
 * of its own collapses instead of laying them out.
 */
export const SearchField = forwardRef<TextInput, Props>(function SearchField(
    {
        value,
        onChangeText,
        placeholder,
        onSubmit,
        onFocus,
        onClear,
        size = "md",
        surface = "glass",
        editable = true,
        autoFocus = false,
        accessibilityLabel,
        className,
    },
    ref,
) {
    const { colors } = useAppTheme();
    const { height, fontSize, icon } = SIZES[size];
    const radius = height / 2;
    const text = { fontSize, paddingVertical: 0, paddingHorizontal: 0 };

    return (
        <View
            className={cn(
                "flex-row items-center gap-2 overflow-hidden px-4",
                editable === false && surface === "outline" && "opacity-50",
                className,
            )}
            style={[
                { height, borderRadius: radius },
                surface === "outline" && {
                    borderWidth: StyleSheet.hairlineWidth * 2,
                    borderColor: withAlpha(colors.mutedForeground, 0.55),
                },
            ]}
        >
            {surface === "glass" ? (
                // off the touch path: a native glass view may not honor
                // `pointerEvents` itself, and it would swallow the taps
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                    <GlassSurface
                        variant="clear"
                        style={[
                            StyleSheet.absoluteFill,
                            { borderRadius: radius },
                        ]}
                    />
                </View>
            ) : null}

            <Ionicons
                name="search"
                size={icon}
                color={colors.mutedForeground}
            />
            <View className="h-full flex-1 justify-center">
                {value.length === 0 ? (
                    <View
                        pointerEvents="none"
                        className="absolute inset-0 justify-center"
                    >
                        <Text
                            numberOfLines={1}
                            style={[text, { color: colors.mutedForeground }]}
                        >
                            {placeholder}
                        </Text>
                    </View>
                ) : null}
                <TextInput
                    ref={ref}
                    style={[text, { height, color: colors.foreground }]}
                    accessibilityLabel={accessibilityLabel ?? placeholder}
                    value={value}
                    onChangeText={onChangeText}
                    onFocus={onFocus}
                    onSubmitEditing={onSubmit}
                    returnKeyType="search"
                    editable={editable}
                    autoFocus={autoFocus}
                    autoCorrect={false}
                    autoCapitalize="none"
                    clearButtonMode="never"
                />
            </View>
            {value.length > 0 && editable ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search text"
                    onPress={onClear ?? (() => onChangeText(""))}
                    hitSlop={10}
                    className="active:opacity-60"
                >
                    <Ionicons
                        name="close-circle"
                        size={icon + 1}
                        color={colors.mutedForeground}
                    />
                </Pressable>
            ) : null}
        </View>
    );
});
