/**
 * One tag's share of a period's listening time.
 *
 * A listen counts in full toward every tag on its song, so shares overlap and
 * can sum past 100%. Nothing here splits or normalizes them. Pure, with only
 * a type import that is erased at runtime, so `tag-share.test.ts` runs it
 * under `node --test`.
 */

import type { Tag } from "@/lib/types";

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
