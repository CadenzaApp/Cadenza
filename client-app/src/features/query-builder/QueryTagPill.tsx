import { View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import type { Tag } from "@/lib/types";
import type { QueryTag } from "./types";
import { quoteQueryTextValue } from "./query-tag-label";
import { OPERATOR_LABELS } from "../advanced-query-builder/AdvancedQueryUtils";
import { formatTagValue } from "@/lib/tag-values";

export function QueryTagPill({
    queryTag,
    height = 14,
}: {
    queryTag: QueryTag;
    height?: number;
}) {
    const constraint = queryTag.constraint;
    const suffix = constraint
        ? `${OPERATOR_LABELS[constraint.op]}${constraint.value === undefined ? "" : ` ${queryTag.tag.type === "text" ? quoteQueryTextValue(formatTagValue("text", constraint.value)) : formatTagValue(queryTag.tag.type, constraint.value)}`}`
        : undefined;
    return (
        <View
            className="min-h-8 justify-center"
            accessible
            accessibilityHint="Drag to move or remove this tag"
            accessibilityLabel={`${queryTag.tag.name}${suffix ? ` ${suffix}` : ""}`}
        >
            <TagPill
                tag={queryTag.tag}
                suffix={suffix}
                height={height}
                suggested={queryTag.suggested}
                leadingIconName={queryTag.suggested ? "sparkles" : undefined}
            />
        </View>
    );
}

/**
 * A suggested (default) tag in the palette, marked by italic text and sparkles.
 */
export function SuggestedTagPill({ tag }: { tag: Tag }) {
    return (
        <View
            className="min-h-8 justify-center"
            accessibilityLabel={`${tag.name}, suggested tag`}
        >
            <TagPill
                tag={tag}
                height={14}
                suggested
                leadingIconName="sparkles"
            />
        </View>
    );
}

export function PaletteTagPill({ tag }: { tag: Tag }) {
    return (
        <View className="min-h-8 justify-center" accessibilityLabel={tag.name}>
            <TagPill tag={tag} height={14} />
        </View>
    );
}
