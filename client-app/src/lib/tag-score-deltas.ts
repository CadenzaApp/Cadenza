/**
 * What one play of a song, and one run of a query, is worth to the tags in it.
 * Only type imports, so it can be unit tested without pulling in React Native.
 */

import type { QueryJSON, QueryJSONNode } from "@/lib/query-json";
import type { TagScoreDeltas } from "@/lib/types";

/** What one play adds to the score of every one of the user's own tags on the song. */
export const LOCAL_TAG_PLAY_SCORE_DELTA = 2;

/** What one play adds to the score of every default tag on the song. */
export const DEFAULT_TAG_PLAY_SCORE_DELTA = 1;

/** What one query run adds to the score of every tag it asks for. */
export const QUERY_TAG_SCORE_DELTA = 10;

/** The backend rejects a `PATCH /tags/scores` naming more tags than this. */
export const TAG_SCORE_NAME_LIMIT = 200;

/**
 * The `PATCH /tags/scores` body for one play of a song, keyed by tag name:
 * `LOCAL_TAG_PLAY_SCORE_DELTA` for every one of the user's own tags on it, and
 * `DEFAULT_TAG_PLAY_SCORE_DELTA` for every default tag on it.
 *
 * Scores go by name rather than by tag id, so two tags sharing a name on one
 * song add up instead of overwriting each other, a local and a default tag
 * included. Names the backend would reject are dropped rather than failing the
 * whole request: a blank one, and anything past `TAG_SCORE_NAME_LIMIT` names,
 * with local tags ahead of default ones. The backend lowercases and collapses
 * whitespace itself, so names go out as the user wrote them.
 */
export function playTagScoreDeltas(
    localTags: readonly { name: string }[],
    defaultTags: readonly { name: string }[],
): TagScoreDeltas {
    return tagScoreDeltas([
        ...localTags.map(({ name }) => ({
            name,
            delta: LOCAL_TAG_PLAY_SCORE_DELTA,
        })),
        ...defaultTags.map(({ name }) => ({
            name,
            delta: DEFAULT_TAG_PLAY_SCORE_DELTA,
        })),
    ]);
}

/**
 * The `PATCH /tags/scores` body for one run of `query`: `QUERY_TAG_SCORE_DELTA`
 * for every tag it uses positively, keyed by tag name.
 *
 * A tag is used positively when the query asks for songs that have it. A tag
 * filter under a `not` is negative, and so is an `is_not_applied` filter, which
 * is how the simple builder writes a NOT APPLIED tag. Two negatives cancel, so
 * `is_not_applied` inside a `not` is positive. A tag used several times counts
 * once, and a tag used both ways counts, since it was asked for somewhere.
 *
 * `tags` resolves the query's tag ids to names. An id it does not know is left
 * out. Name filters (`tag_name`, `tag_value`, `tag_type`) name no one tag, so
 * they score nothing. Names are cleaned up the same way as `playTagScoreDeltas`.
 */
export function queryTagScoreDeltas(
    query: QueryJSON,
    tags: readonly { id: number; name: string }[],
): TagScoreDeltas {
    const tagIds = new Set<number>();
    collectPositiveTagIds(query.where, false, tagIds);

    const names = new Map(tags.map((tag) => [tag.id, tag.name]));
    const usedTags: { name: string; delta: number }[] = [];
    for (const tagId of tagIds) {
        const name = names.get(tagId);
        if (name !== undefined)
            usedTags.push({ name, delta: QUERY_TAG_SCORE_DELTA });
    }

    return tagScoreDeltas(usedTags);
}

/** Adds the id of every tag `node` asks for to `out`. */
function collectPositiveTagIds(
    node: QueryJSONNode,
    negated: boolean,
    out: Set<number>,
) {
    if ("and" in node) {
        for (const child of node.and)
            collectPositiveTagIds(child, negated, out);
    } else if ("or" in node) {
        for (const child of node.or) collectPositiveTagIds(child, negated, out);
    } else if ("not" in node) {
        collectPositiveTagIds(node.not, !negated, out);
    } else if (node.filter.field === "tag") {
        const excludes = node.filter.op === "is_not_applied";
        if (negated === excludes) out.add(node.filter.tag_id);
    }
}

/** Each tag's delta, added up by name, minus what the backend rejects. */
function tagScoreDeltas(
    tags: readonly { name: string; delta: number }[],
): TagScoreDeltas {
    const deltas = new Map<string, number>();

    for (const { name, delta } of tags) {
        if (!name.trim()) continue;
        if (!deltas.has(name) && deltas.size === TAG_SCORE_NAME_LIMIT) continue;
        deltas.set(name, (deltas.get(name) ?? 0) + delta);
    }

    return Object.fromEntries(deltas);
}
