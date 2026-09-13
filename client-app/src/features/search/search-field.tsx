import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import { forwardRef } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { GlassSurface } from "@/components/ui/glass-surface";
import { THEME } from "@/lib/theme";

const FIELD_HEIGHT = 44;
const FIELD_RADIUS = FIELD_HEIGHT / 2;
/**
 * Lifts the text off the true center. A line box centers on its font metrics,
 * descender space included, so text with no descenders in it reads low.
 */
const TEXT_NUDGE_Y = -3;

type Props = {
    value: string;
    onChangeText: (text: string) => void;
    onSubmit: () => void;
    onFocus?: () => void;
    onClear: () => void;
    placeholder?: string;
    editable?: boolean;
    autoFocus?: boolean;
};

/**
 * The search pill.
 *
 * The glass is an absolutely positioned layer behind the content, the way
 * `GlassIconButton` does it, and the wrapper owns the size, the radius, and
 * the clip. A native glass view given children and no size of its own collapses
 * instead of laying them out, which is what broke the first version of this.
 *
 * A bare `TextInput` rather than `@/components/ui/input`: that primitive is a
 * bordered, filled form field, and every one of its base classes would have to
 * be overridden here.
 */
export const SearchField = forwardRef<TextInput, Props>(function SearchField(
    {
        value,
        onChangeText,
        onSubmit,
        onFocus,
        onClear,
        placeholder = "Artists, Songs, Lyrics, and More",
        editable = true,
        autoFocus = false,
    },
    ref,
) {
    const { colorScheme } = useColorScheme();
    const palette = THEME[colorScheme === "dark" ? "dark" : "light"];

    return (
        <View
            className="flex-1 justify-center overflow-hidden"
            style={{ height: FIELD_HEIGHT, borderRadius: FIELD_RADIUS }}
        >
            {/* Off the touch path: a native glass view may not honor
                `pointerEvents` itself, and it would swallow the taps. */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <GlassSurface
                    variant="clear"
                    style={[
                        StyleSheet.absoluteFill,
                        { borderRadius: FIELD_RADIUS },
                    ]}
                />
            </View>

            <View className="flex-row items-center gap-2 px-4">
                <Ionicons
                    name="search"
                    size={17}
                    color={palette.mutedForeground}
                />
                <TextInput
                    ref={ref}
                    // No height of its own: the row centers it. A fixed height
                    // on a TextInput leaves the text sitting high, because the
                    // platform pads the text box rather than centering it.
                    style={{
                        color: palette.foreground,
                        paddingVertical: 0,
                        includeFontPadding: false,
                        transform: [{ translateY: TEXT_NUDGE_Y }],
                    }}
                    className="flex-1 text-base"
                    placeholder={placeholder}
                    placeholderTextColor={palette.mutedForeground}
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
                {value.length > 0 ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Clear search text"
                        onPress={onClear}
                        hitSlop={10}
                        className="active:opacity-60"
                    >
                        <Ionicons
                            name="close-circle"
                            size={18}
                            color={palette.mutedForeground}
                        />
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
});
