import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";

import { TagPill, useTagScreenColor } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";
import type { Tag } from "@/lib/types";
import type { QueryTag } from "./types";

export function QueryTagPill({
    queryTag,
    onToggle,
    height = 12.5,
}: {
    queryTag: QueryTag;
    onToggle?: () => void;
    height?: number;
}) {
    const screenColor = useTagScreenColor(queryTag.tag.color);
    const isAttributeTag = queryTag.tag.type !== "basic";

    // The tap that toggles NOT belongs to the wrapping drag gesture, so this
    // surface stays a plain View. A Pressable here would fight that gesture
    // through the React Native responder system.
    return (
        <View
            className="min-h-8 justify-center"
            accessible
            accessibilityRole="button"
            accessibilityLabel={`${queryTag.negated ? "Not " : ""}${queryTag.tag.name}`}
            accessibilityHint="Toggles whether this tag is excluded"
            onAccessibilityTap={onToggle}
        >
            {queryTag.negated ? (
                <NegatedTagPill tag={queryTag.tag} height={height} />
            ) : (
                <TagPill
                    tag={queryTag.tag}
                    height={height}
                    inverted={queryTag.suggested}
                    leadingIcon={
                        isAttributeTag ? undefined : (
                            <Ionicons
                                name="ellipse"
                                size={1.04 * height}
                                color={
                                    queryTag.suggested
                                        ? queryTag.tag.color
                                        : screenColor
                                }
                            />
                        )
                    }
                />
            )}
        </View>
    );
}

/**
 * A negated tag: a solid NOT badge joined to the tag name on the pill's own
 * screen color. It is built by hand rather than through `TagPill` because the
 * two segments are colored independently, so it takes the same screen color
 * `TagPill` would have used and stays legible against a dark tag color.
 */
function NegatedTagPill({ tag, height }: { tag: Tag; height: number }) {
    const screenColor = useTagScreenColor(tag.color);
    const iconName =
        tag.type === "basic" ? "close-circle" : TAG_TYPE_ICONS[tag.type];

    return (
        <View
            pointerEvents="none"
            className="flex-row items-stretch overflow-hidden rounded-full border"
            style={{ borderColor: tag.color, backgroundColor: screenColor }}
        >
            <View
                className="flex-row items-center justify-center"
                style={{
                    backgroundColor: tag.color,
                    gap: 0.2 * height,
                    paddingHorizontal: 0.3 * height,
                    paddingVertical: 0.2 * height,
                }}
            >
                <Ionicons
                    name={iconName}
                    size={1.08 * height}
                    color={screenColor}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                />
                <Text
                    style={{
                        color: screenColor,
                        fontSize: 0.82 * height,
                        fontWeight: "800",
                        lineHeight: height * 1.25,
                        includeFontPadding: false,
                    }}
                >
                    NOT
                </Text>
            </View>
            <View
                className="items-center justify-center"
                style={{
                    paddingHorizontal: 0.7 * height,
                    paddingVertical: 0.2 * height,
                }}
            >
                <Text
                    style={{
                        color: tag.color,
                        fontSize: height,
                        fontWeight: "600",
                        lineHeight: height * 1.25,
                        includeFontPadding: false,
                    }}
                >
                    {tag.name}
                </Text>
            </View>
        </View>
    );
}

/**
 * A suggested (default) tag in the palette. Inverted so it reads as a shared
 * suggestion rather than one of the user's own tags, the same way it does once
 * it is in the query.
 */
export function SuggestedTagPill({ tag }: { tag: Tag }) {
    return (
        <View
            className="min-h-9 justify-center"
            accessible
            accessibilityLabel={`${tag.name}, suggested tag`}
            accessibilityHint="Drag this tag into the query"
        >
            <TagPill tag={tag} height={14} inverted />
        </View>
    );
}

export function PaletteTagPill({ tag }: { tag: Tag }) {
    return (
        <View
            className="min-h-9 justify-center"
            accessible
            accessibilityLabel={tag.name}
            accessibilityHint="Drag this tag into the query"
        >
            <TagPill tag={tag} height={14} />
        </View>
    );
}
