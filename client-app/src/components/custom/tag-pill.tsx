import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "nativewind";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Tag } from "../../lib/types";
import { TAG_TYPE_ICONS, formatTagValue } from "../../lib/tag-values";

/** At or below this luminance a color counts as dark. */
const LIGHT_LUMINANCE = 50;
/** What a lifted screen color is raised to, so any dark tag color clears it. */
const LIFTED_SCREEN_LUMINANCE = 220;

function hexChannels(hex: string) {
    return {
        red: parseInt(hex.slice(1, 3), 16),
        green: parseInt(hex.slice(3, 5), 16),
        blue: parseInt(hex.slice(5, 7), 16),
    };
}

// Helper to lighten hex colors
function hexToRgba(hex: string, alpha: number) {
    const { red, green, blue } = hexChannels(hex);
    return `rgba(${red},${green},${blue},${alpha})`;
}

/** Perceptual luminance of a hex color, on the same 0 to 255 channel scale. */
function luminance(hex: string) {
    const { red, green, blue } = hexChannels(hex);
    return (red * 299 + green * 587 + blue * 114) / 1000;
}

/** Mixes a hex color toward white. `amount` is 0 for no change, 1 for white. */
function lighten(hex: string, amount: number) {
    const { red, green, blue } = hexChannels(hex);
    const lift = (channel: number) =>
        Math.round(channel + (255 - channel) * amount)
            .toString(16)
            .padStart(2, "0");
    return `#${lift(red)}${lift(green)}${lift(blue)}`;
}

/**
 * The screen color a pill pairs with its tag color. A dark tag reads against
 * neither a dark interior nor a dark label, so the screen color is lightened
 * until it clears the tag. A light theme is already past that and never moves.
 * Mixing toward white is linear in luminance, so one step lands on the target.
 */
function screenColorFor(screenHex: string, tagHex: string) {
    if (luminance(tagHex) > LIGHT_LUMINANCE) return screenHex;
    const screenLuminance = luminance(screenHex);
    if (screenLuminance >= LIFTED_SCREEN_LUMINANCE) return screenHex;
    return lighten(
        screenHex,
        (LIFTED_SCREEN_LUMINANCE - screenLuminance) / (255 - screenLuminance),
    );
}

/**
 * The screen color a pill of this tag color pairs with. Exported for surfaces
 * that are built by hand rather than through `TagPill` but still have to sit
 * beside one, like the query builder's negated pill.
 */
export function useTagScreenColor(tagColor: string) {
    const { colorScheme = "light" } = useColorScheme();
    return screenColorFor(THEME[colorScheme].background, tagColor);
}

/**
 * A pill shaped badge that represents a tag
 *
 * @param tag       - The tag object (id, name, hex color, type).
 * @param height    - Controls all sizing proportionally (font, icon, padding).
 * @param value     - If provided, renders the attribute tag's value after the
 *                   name, formatted for the tag's type.
 * @param count     - If provided, renders a count badge on the right side.
 * @param leadingIcon - Replaces the leading dot when provided.
 * @param showIcon  - Whether to render the leading dot or icon.
 * @param inverted  - Swaps the pill's text and background colors, so the tag
 *                    color becomes the content over a screen-colored interior
 *                    with a tag-colored outline.
 * @param onRemove  - If provided, renders an × button inside the pill.
 *                   Called when the user taps it and caller decides what to do.
 */
export function TagPill({
    tag,
    height,
    value,
    count,
    leadingIcon,
    showIcon = true,
    inverted = false,
    onRemove,
}: {
    tag: Tag;
    height: number;
    value?: string | null;
    count?: number;
    leadingIcon?: ReactNode;
    showIcon?: boolean;
    inverted?: boolean;
    onRemove?: () => void;
}) {
    const screenColor = useTagScreenColor(tag.color);
    const contentColor = inverted ? tag.color : screenColor;
    const iconSize = 1.15 * height;
    const dotSize = 0.8 * height;
    const fontSize = 1 * height;
    const countFontSize = 0.9 * height;
    const countPaddingHorizontal = 0.9 * height;
    const countPaddingVertical = 0.1 * height;
    const displayedValue = formatTagValue(tag.type, value);

    return (
        <Badge
            variant="outline"
            pointerEvents={onRemove ? "box-none" : "none"}
            style={{
                backgroundColor: inverted ? screenColor : tag.color,
                borderColor: inverted ? tag.color : "transparent",
                paddingHorizontal: 0.7 * height,
                paddingVertical: 0.2 * height,
                gap: 0.5 * height,
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            {showIcon
                ? (leadingIcon ??
                  (tag.type === "basic" ? (
                      <View
                          style={{
                              backgroundColor: contentColor,
                              width: dotSize,
                              height: dotSize,
                              borderRadius: 999,
                          }}
                      />
                  ) : (
                      <Ionicons
                          name={TAG_TYPE_ICONS[tag.type]}
                          size={iconSize}
                          color={contentColor}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                      />
                  )))
                : null}
            {/* Tag text */}
            <Text
                style={{
                    color: contentColor,
                    fontSize,
                    fontWeight: "600",
                    lineHeight: fontSize * 1.25,
                    textAlign: "center",
                    textAlignVertical: "center",
                    includeFontPadding: false,
                }}
            >
                {tag.name}
            </Text>
            {/* Value of an attribute tag, when it has one */}
            {displayedValue !== "" && (
                <Text
                    numberOfLines={1}
                    style={{
                        color: contentColor,
                        fontSize,
                        fontWeight: "400",
                        lineHeight: fontSize * 1.4,
                        opacity: 0.75,
                        maxWidth: 14 * height,
                    }}
                >
                    {displayedValue}
                </Text>
            )}
            {/* Count of songs for that tag */}
            {count !== undefined && (
                <View
                    style={{
                        borderRadius: 999,
                        paddingHorizontal: countPaddingHorizontal,
                        paddingVertical: countPaddingVertical,
                        backgroundColor: hexToRgba(contentColor, 0.2),
                    }}
                >
                    <Text
                        style={{
                            color: contentColor,
                            fontSize: countFontSize,
                            fontWeight: "500",
                            lineHeight: fontSize * 1.25,
                            textAlignVertical: "center",
                            includeFontPadding: false,
                        }}
                    >
                        {count}
                    </Text>
                </View>
            )}
            {/* x button to remove the tag */}
            {onRemove && (
                <Pressable
                    onPress={onRemove}
                    hitSlop={6}
                    style={({ pressed }) => [
                        { alignSelf: "center" },
                        pressed && { opacity: 0.4 },
                    ]}
                >
                    <Text
                        style={{
                            color: contentColor,
                            fontSize: fontSize * 1.1,
                            fontWeight: "400",
                            lineHeight: fontSize * 1.4,
                            opacity: 0.55,
                        }}
                    >
                        ×
                    </Text>
                </Pressable>
            )}
        </Badge>
    );
}

/** Black or white, whichever has better contrast against the supplied color. */
export function readableTextColor(hex: string) {
    return luminance(hex) > LIGHT_LUMINANCE ? "#000000" : "#ffffff";
}
