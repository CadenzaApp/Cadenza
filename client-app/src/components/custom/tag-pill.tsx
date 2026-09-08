import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
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
 * @param compact   - Renders a solid circular badge containing the tag initial.
 * @param count     - If provided, renders a count badge on the right side.
 * @param onRemove  - If provided, renders an × button inside the pill.
 *                   Called when the user taps it and caller decides what to do.
 */
export function TagPill({
    tag,
    height,
    count,
    onRemove,
    compact = false,
}: {
    tag: Tag;
    height: number;
    count?: number;
    onRemove?: () => void;
    compact?: boolean;
}) {
    const dotSize = 0.8 * height;
    const fontSize = 1 * height;
    const countFontSize = 0.9 * height;
    const countPaddingHorizontal = 0.9 * height;
    const countPaddingVertical = 0.1 * height;

    if (compact) {
        const diameter = 1.8 * height;
        const compactBadge = (
            <Badge
                pointerEvents="none"
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
            {/* Colored dot */}
            <View
                style={{
                    backgroundColor: tag.color,
                    width: dotSize,
                    height: dotSize,
                    borderRadius: 999,
                }}
            />
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

function readableTextColor(hex: string) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance > 150 ? "#000000" : "#ffffff";
}
