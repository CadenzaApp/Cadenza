import type { TagMetadata } from "@/lib/types";

export type SelectableTag = {
    id: number;
    name: string;
};

export type TagSelectionContext =
    | {
          kind: "single";
          initiallyChosenIds: ReadonlySet<number>;
          suggestedNames: ReadonlySet<string>;
      }
    | {
          kind: "multiple";
          initiallyPresentIds: ReadonlySet<number>;
      };

const normalizeName = (name: string) => name.trim().toLowerCase();

/** Stable initial selector order. Chosen state changes do not call this again. */
export function sortTagSelectorItems<T extends SelectableTag>(
    tags: readonly T[],
    context: TagSelectionContext,
    metadata?: Readonly<Record<number, TagMetadata>>,
): T[] {
    return [...tags].sort((left, right) => {
        const leftPrimary = primaryRank(left, context);
        const rightPrimary = primaryRank(right, context);
        if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;

        const countDifference =
            (metadata?.[right.id]?.count ?? 0) -
            (metadata?.[left.id]?.count ?? 0);
        if (countDifference !== 0) return countDifference;

        const nameDifference = normalizeName(left.name).localeCompare(
            normalizeName(right.name),
        );
        return nameDifference !== 0 ? nameDifference : left.id - right.id;
    });
}

function primaryRank(tag: SelectableTag, context: TagSelectionContext) {
    if (context.kind === "multiple") {
        return context.initiallyPresentIds.has(tag.id) ? 0 : 1;
    }
    if (context.initiallyChosenIds.has(tag.id)) return 0;
    return context.suggestedNames.has(normalizeName(tag.name)) ? 1 : 2;
}

/** One explicit page plus newly created/adopted tags that must stay visible. */
export function visibleTagSelectorItems<T extends { id: number }>(
    tags: readonly T[],
    visibleCount: number,
    forceVisibleTagIds: readonly number[] = [],
): T[] {
    const forcedIds = new Set(forceVisibleTagIds);
    return tags.filter(
        (tag, index) => index < visibleCount || forcedIds.has(tag.id),
    );
}
