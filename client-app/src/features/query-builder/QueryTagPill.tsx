import { View } from "react-native";

import { TagPill } from "@/components/custom/tag-pill";
import { formatTagValue } from "@/lib/tag-values";
import type { Tag } from "@/lib/types";
import { OPERATOR_LABELS } from "../advanced-query-builder/AdvancedQueryUtils";
import type { QueryTag } from "./types";

export function QueryTagPill({
    queryTag,
    height = 14,
}: {
    queryTag: QueryTag;
    height?: number;
}) {
    const constraint = queryTag.constraint;
    const suffix = constraint
        ? `${OPERATOR_LABELS[constraint.op]}${constraint.value === undefined ? "" : ` ${queryTag.tag.type === "text" ? JSON.stringify(formatTagValue("text", constraint.value)) : formatTagValue(queryTag.tag.type, constraint.value)}`}`
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

export function PaletteTagPill({
    tag,
    count,
    suggested = false,
}: {
    tag: Tag;
    count?: number;
    suggested?: boolean;
}) {
    return (
        <View
            className="min-h-8 justify-center"
            accessibilityLabel={`${tag.name}${suggested ? ", suggested tag" : ""}`}
        >
            <TagPill
                tag={tag}
                height={14}
                count={count}
                suggested={suggested}
                leadingIconName={suggested ? "sparkles" : undefined}
            />
        </View>
    );
}
