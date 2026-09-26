import type { AppliedTag, Tag, TagMetadata } from "@/lib/types";

export type VisibleMusicListTag =
    | { source: "local"; tag: AppliedTag }
    | { source: "default"; tag: Tag };

function normalizedTagName(name: string): string {
    return name.trim().toLowerCase();
}

/**
 * Orders every visible tag with the same list-wide priorities. Explicitly
 * relevant names win first, followed by the user's library application count.
 */
export function sortMusicListTags(
    tags: readonly AppliedTag[],
    defaultTags: readonly Tag[],
    mostRelevantTags: readonly string[],
    metadata?: Readonly<Record<number, TagMetadata>>,
): VisibleMusicListTag[] {
    const relevance = new Map<string, number>();
    for (const name of mostRelevantTags) {
        const normalized = normalizedTagName(name);
        if (normalized && !relevance.has(normalized)) {
            relevance.set(normalized, relevance.size);
        }
    }

    return [
        ...tags.map((tag): VisibleMusicListTag => ({ source: "local", tag })),
        ...defaultTags.map(
            (tag): VisibleMusicListTag => ({ source: "default", tag }),
        ),
    ].sort((left, right) => {
        const leftName = normalizedTagName(left.tag.name);
        const rightName = normalizedTagName(right.tag.name);
        const leftRelevance = relevance.get(leftName);
        const rightRelevance = relevance.get(rightName);
        if (leftRelevance != null || rightRelevance != null) {
            if (leftRelevance == null) return 1;
            if (rightRelevance == null) return -1;
            if (leftRelevance !== rightRelevance) {
                return leftRelevance - rightRelevance;
            }
        }

        const countDifference =
            (metadata?.[right.tag.id]?.count ?? 0) -
            (metadata?.[left.tag.id]?.count ?? 0);
        if (countDifference !== 0) return countDifference;

        const nameDifference = leftName.localeCompare(rightName);
        if (nameDifference !== 0) return nameDifference;
        if (left.tag.id !== right.tag.id) return left.tag.id - right.tag.id;
        return left.source.localeCompare(right.source);
    });
}
