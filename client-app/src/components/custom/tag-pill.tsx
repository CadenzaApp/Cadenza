import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "nativewind";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { Tag } from "../../lib/types";

// Helper to lighten hex colors
function hexToRgba(hex: string, alpha: number) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * A pill shaped badge that represents a tag
 *
 * @param tag       - The tag object (id, name, hex color).
 * @param height    - Controls all sizing proportionally (font, dot, padding).
 * @param count     - If provided, renders a count badge on the right side.
 * @param leadingIcon - Replaces the leading dot when provided.
 * @param showIcon  - Whether to render the leading dot or icon.
 * @param outlined  - Uses the tag color for its border and content with no fill.
 * @param strikethrough - Draws a standard thin line through the tag label.
 * @param onRemove  - If provided, renders an × button inside the pill.
 *                   Called when the user taps it and caller decides what to do.
 */
export function TagPill({
    tag,
    height,
    count,
    leadingIcon,
    showIcon = true,
    outlined = false,
    strikethrough = false,
    onRemove,
}: {
    tag: Tag;
    height: number;
    count?: number;
    leadingIcon?: ReactNode;
    showIcon?: boolean;
    outlined?: boolean;
    strikethrough?: boolean;
    onRemove?: () => void;
}) {
    const { colorScheme = "light" } = useColorScheme();
    const backgroundColor = THEME[colorScheme].background;
    const contentColor = outlined ? tag.color : backgroundColor;
    const dotSize = 0.8 * height;
    const fontSize = 1 * height;
    const countFontSize = 0.9 * height;
    const countPaddingHorizontal = 0.9 * height;
    const countPaddingVertical = 0.1 * height;

    return (
        <Badge
            variant="outline"
            pointerEvents={onRemove ? "box-none" : "none"}
            style={{
                backgroundColor: outlined ? "transparent" : tag.color,
                borderColor: outlined ? tag.color : "transparent",
                paddingHorizontal: 0.7 * height,
                paddingVertical: 0.2 * height,
                gap: 0.5 * height,
                alignItems: "center",
                justifyContent: "center",
            }}
        >
            {showIcon
                ? (leadingIcon ?? (
                      <View
                          style={{
                              backgroundColor: contentColor,
                              width: dotSize,
                              height: dotSize,
                              borderRadius: 999,
                          }}
                      />
                  ))
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
                    textDecorationLine: strikethrough ? "line-through" : "none",
                    textDecorationStyle: "solid",
                    textDecorationColor: contentColor,
                }}
            >
                {tag.name}
            </Text>
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
