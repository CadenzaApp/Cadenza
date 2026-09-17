import Ionicons from "@expo/vector-icons/Ionicons";
import { View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { TAG_TYPE_ICONS } from "@/lib/tag-values";
import type { Tag } from "@/lib/types";
import { useColorScheme } from "nativewind";
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
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
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
                    leadingIcon={
                        isAttributeTag ? undefined : (
                            <Ionicons
                                name="ellipse"
                                size={1.04 * height}
                                color={theme.background}
                            />
                        )
                    }
                />
            )}
        </View>
    );
}

function NegatedTagPill({ tag, height }: { tag: Tag; height: number }) {
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const iconName =
        tag.type === "basic" ? "close-circle" : TAG_TYPE_ICONS[tag.type];

    return (
        <View
            pointerEvents="none"
            className="flex-row items-stretch overflow-hidden rounded-full border"
            style={{ borderColor: tag.color }}
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
                    color={theme.background}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                />
                <Text
                    style={{
                        color: theme.background,
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
