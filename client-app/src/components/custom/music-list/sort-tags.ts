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

/**
 * What a row's tag rail leads with when its list is sorted by a tag: one of
 * the row's own pills, moved to the front, or a pill made on screen with the
 * song's value of a metadata tag.
 */
export type RailLead =
    | {
          kind: "tag";
          tagId: number;
          source: "own" | "activity" | "suggested";
      }
    | { kind: "pill"; tag: Tag; value: string };

/** Where a rail pill came from, the same word a `RailLead` uses for it. */
export type RailPillSource = "own" | "activity" | "suggested" | "lead";

/**
 * `pills` with the one `lead` names first, the rest in their order. A lead
 * the row does not carry, like a tag the song does not have, changes nothing.
 */
export function leadPillFirst<
    Pill extends { source: RailPillSource; tag: { id: number } },
>(pills: readonly Pill[], lead: RailLead | undefined): readonly Pill[] {
    if (lead?.kind !== "tag") return pills;
    const index = pills.findIndex(
        (pill) => pill.source === lead.source && pill.tag.id === lead.tagId,
    );
    if (index <= 0) return pills;
    return [pills[index], ...pills.slice(0, index), ...pills.slice(index + 1)];
}
