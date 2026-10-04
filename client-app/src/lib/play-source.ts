/**
 * Where a play started, when that was somewhere worth ranking.
 *
 * A playlist or a query is not a property of a song, so nothing on the track
 * says it. The screen that starts the queue knows, hands it to `playQueue`, and
 * the play recorder writes it onto `play_counted` as `source_kind`, `source_id`
 * and `source_name`. The backend's playlist and query rankings group on those.
 *
 * Pure apart from a type import, so `play-source.test.ts` runs it under
 * `node --test`.
 */

import type { QueryJSON } from "./query-json";

export type PlaySourceKind = "playlist" | "query";

export type PlaySource = {
    kind: PlaySourceKind;
    /**
     * What opens it again. A playlist's library id, or for a query the query
     * itself, from `encodeQuerySource`.
     */
    id: string;
    /** What the ranking shows. The newest name wins on the backend. */
    name: string;
};

/** What reruns a query: the tree and whether suggested tags were on. */
export type QuerySource = { query: QueryJSON; suggested: boolean };

/**
 * A query as a source id. The query is its own identity, since saved queries
 * do not exist, so the same query run twice ranks as one row. Both builders
 * emit their tree in a fixed key order, which keeps the string stable.
 */
export function encodeQuerySource(source: QuerySource): string {
    return JSON.stringify({
        query: source.query,
        suggested: source.suggested,
    });
}

/** The query back out of a source id, or null when it is not one. */
export function decodeQuerySource(id: string): QuerySource | null {
    try {
        const value: unknown = JSON.parse(id);
        if (typeof value !== "object" || value === null) return null;
        const { query, suggested } = value as Record<string, unknown>;
        if (typeof query !== "object" || query === null) return null;
        if (!("where" in query)) return null;
        return { query: query as QueryJSON, suggested: suggested === true };
    } catch {
        return null;
    }
}
