import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Tag } from "../../lib/types";
import { TAG_TYPE_ICONS, formatTagValue } from "../../lib/tag-values";

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
 * @param tag       - The tag object (id, name, hex color, type).
 * @param height    - Controls all sizing proportionally (font, icon, padding).
 *
 * Attribute tags lead with their type icon; basic tags keep a plain colored dot.
 * @param value     - If provided, renders the attribute tag's value after the
 *                   name, formatted for the tag's type.
 * @param count     - If provided, renders a count badge on the right side.
 * @param onRemove  - If provided, renders an × button inside the pill.
 *                   Called when the user taps it and caller decides what to do.
 * @param compact   - Renders a solid circular badge containing the tag initial.
 */
export function TagPill({
    tag,
    height,
    value,
    count,
    onRemove,
    compact = false,
}: {
    tag: Tag;
    height: number;
    value?: string | null;
    count?: number;
    onRemove?: () => void;
    compact?: boolean;
}) {
    const iconSize = 1.15 * height;
    const dotSize = 0.8 * height;
    const fontSize = 1 * height;
    const countFontSize = 0.9 * height;
    const countPaddingHorizontal = 0.9 * height;
    const countPaddingVertical = 0.1 * height;
    const displayedValue = formatTagValue(tag.type, value);

    if (compact) {
        const diameter = 1.8 * height;
        const compactBadge = (
            <Badge
                pointerEvents="none"
                accessible={!onRemove}
                accessibilityLabel={tag.name}
                style={{
                    width: diameter,
                    height: diameter,
                    minWidth: diameter,
                    borderRadius: diameter / 2,
                    borderColor: "transparent",
                    backgroundColor: tag.color,
                    paddingHorizontal: 0,
                    paddingVertical: 0,
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                <Text
                    style={{
                        color: readableTextColor(tag.color),
                        fontSize: height,
                        fontWeight: "700",
                        lineHeight: diameter,
                        textAlign: "center",
                    }}
                >
                    {tag.name.trim().charAt(0).toLocaleUpperCase() || "?"}
                </Text>
            </Badge>
        );

        return onRemove ? (
            <Pressable
                onPress={onRemove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${tag.name} tag`}
                hitSlop={6}
                style={({ pressed }) => pressed && { opacity: 0.4 }}
            >
                {compactBadge}
            </Pressable>
        ) : (
            compactBadge
        );
    }

    return (
        <Badge
            variant="outline"
            pointerEvents={onRemove ? "box-none" : "none"}
            style={{
                backgroundColor: hexToRgba(tag.color, 0.2),
                borderColor: "transparent",
                paddingHorizontal: 0.9 * height,
                paddingVertical: 0.2 * height,
                gap: 0.5 * height,
            }}
        >
            {tag.type === "basic" ? (
                /* Colored dot for basic tags */
                <View
                    style={{
                        backgroundColor: tag.color,
                        width: dotSize,
                        height: dotSize,
                        borderRadius: 999,
                    }}
                />
            ) : (
                /* Type icon, the same one the advanced query builder shows */
                <Ionicons
                    name={TAG_TYPE_ICONS[tag.type] ?? TAG_TYPE_ICONS.basic}
                    size={iconSize}
                    color={tag.color}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                />
            )}
            {/* Tag text */}
            <Text
                style={{
                    color: tag.color,
                    fontSize,
                    fontWeight: "500",
                    lineHeight: fontSize * 1.4,
                }}
            >
                {tag.name}
            </Text>
            {/* Value of an attribute tag, when it has one */}
            {displayedValue !== "" && (
                <Text
                    numberOfLines={1}
                    style={{
                        color: tag.color,
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
                        backgroundColor: hexToRgba(tag.color, 0.25),
                    }}
                >
                    <Text
                        style={{
                            color: tag.color,
                            fontSize: countFontSize,
                            fontWeight: "500",
                            lineHeight: fontSize * 1.4,
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
                            color: tag.color,
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

/** Black or white, whichever reads on the given hex background. */
export function readableTextColor(hex: string) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance > 150 ? "#000000" : "#ffffff";
}
