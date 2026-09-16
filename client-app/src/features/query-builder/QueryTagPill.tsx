import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { THEME } from "@/lib/theme";
import type { Tag } from "@/lib/types";
import { useColorScheme } from "nativewind";
import type { QueryTag } from "./types";

export function QueryTagPill({
    queryTag,
    onToggle,
}: {
    queryTag: QueryTag;
    onToggle: () => void;
}) {
    const { colorScheme = "light" } = useColorScheme();
    const theme = THEME[colorScheme];
    const isAttributeTag = queryTag.tag.type !== "basic";

    return (
        <Pressable
            onPress={onToggle}
            className="min-h-8 justify-center"
            accessibilityRole="button"
            accessibilityLabel={`${queryTag.negated ? "Not " : ""}${queryTag.tag.name}`}
            accessibilityHint="Toggles whether this tag is excluded"
        >
            <TagPill
                tag={queryTag.tag}
                height={12.5}
                outlined={queryTag.negated}
                strikethrough={queryTag.negated}
                leadingIcon={
                    isAttributeTag ? undefined : (
                        <Ionicons
                            name={queryTag.negated ? "close-circle" : "ellipse"}
                            size={13}
                            color={
                                queryTag.negated
                                    ? queryTag.tag.color
                                    : theme.background
                            }
                        />
                    )
                }
            />
        </Pressable>
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
