import { View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import type { Tag } from "@/lib/types";
import type { QueryTag } from "./types";

export function QueryTagPill({
    queryTag,
    height = 12.5,
}: {
    queryTag: QueryTag;
    height?: number;
}) {
    return (
        <View
            className="min-h-8 justify-center"
            accessible
            accessibilityLabel={queryTag.tag.name}
        >
            <TagPill
                tag={queryTag.tag}
                height={height}
                inverted={queryTag.suggested}
            />
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
