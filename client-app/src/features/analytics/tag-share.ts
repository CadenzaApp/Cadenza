/**
 * One tag's share of a period's listening time.
 *
 * A listen counts in full toward every tag on its song, so shares overlap and
 * can sum past 100%. Nothing here splits or normalizes them. Pure, with only
 * type imports that are erased at runtime, so `tag-share.test.ts` runs it
 * under `node --test`.
 */

import type { TagListeningTime } from "@/lib/routes/analytics";
import type { ListeningTag } from "@/lib/routes/analytics-listening";
import type { Tag } from "@/lib/types";

/** The untagged entry's id. Real tag ids start at 1. */
export const UNTAGGED_TAG_ID = 0;

/**
 * The tag the heatmap is filtered to, or null for all listening. Kept whole,
 * so a period without the tag still shows it pinned, at zero.
 */
export type TagFilter = Tag | null;

/**
 * The tag's part of the total, 0 to 1. Zero when nothing played, and never
 * past 1 even if the two reads disagree for a moment.
 */
export function shareOf(tagMs: number, totalMs: number): number {
    if (!(totalMs > 0) || !(tagMs > 0)) return 0;
    return Math.min(1, tagMs / totalMs);
}

/** A share as a whole percent, `70`. */
export function sharePercent(share: number): number {
    return Math.round(share * 100);
}

/**
 * A share as the chip reads it, `70%`. Some time that rounds to nothing reads
 * `<1%`, so a tag that was played never claims 0%.
 */
export function formatSharePercent(tagMs: number, totalMs: number): string {
    const percent = sharePercent(shareOf(tagMs, totalMs));
    return percent === 0 && tagMs > 0 && totalMs > 0 ? "<1%" : `${percent}%`;
}

/**
 * The tags with an Untagged entry for the time on songs with none of them,
 * placed by its time like any tag. Left out when there is none. `taggedMs`
 * counts each listen once, so the rest of `totalMs` is untagged.
 */
export function withUntagged(
    tags: readonly TagListeningTime[],
    totalMs: number,
    taggedMs: number,
): TagListeningTime[] {
    const untaggedMs = totalMs - taggedMs;
    if (!(untaggedMs > 0)) return [...tags];
    const untagged: TagListeningTime = {
        id: UNTAGGED_TAG_ID,
        name: "Untagged",
        color: "#a3a3a3",
        type: "basic",
        listening_ms: untaggedMs,
    };
    const at = tags.findIndex((tag) => tag.listening_ms < untaggedMs);
    return at < 0
        ? [...tags, untagged]
        : [...tags.slice(0, at), untagged, ...tags.slice(at)];
}

/** The listening reads' filter for a selected tag, Untagged included. */
export function listeningTag(filter: TagFilter): ListeningTag {
    if (!filter) return null;
    return filter.id === UNTAGGED_TAG_ID ? "untagged" : filter.id;
}
