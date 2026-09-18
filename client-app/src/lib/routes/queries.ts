import { useMemo } from "react";

import type { QueryJSON } from "@/lib/query-json";
import { useAPIPostData } from "../api-actions";

type QueryResultsBody = {
    query: QueryJSON;
    song_ids: string[];
    consider_default_tags: boolean;
};

/**
 * Song ids matching `query`, most relevant first. Both builders compile to the
 * same wire format, so this is the only query hook.
 *
 * `candidateSongIds` is the current Apple Music library, which the backend
 * evaluates the query over. It is what lets a "not applied" filter match a song
 * with no tags on it at all, so the hook waits for `candidatesReady` rather than
 * querying against a partial library.
 *
 * `considerDefaultTags` widens what the backend counts as a tag on a song to
 * include the shared default tags. It is part of the cache key, so turning it on
 * and off refetches rather than reusing the other answer.
 */
export function useQueryResults(
    query: QueryJSON | null,
    candidateSongIds: readonly string[],
    candidatesReady: boolean,
    considerDefaultTags: boolean,
) {
    const body = useMemo<QueryResultsBody | null>(() => {
        if (!query || !candidatesReady) return null;
        return {
            query,
            song_ids: [...new Set(candidateSongIds.filter(Boolean))],
            consider_default_tags: considerDefaultTags,
        };
    }, [candidateSongIds, candidatesReady, considerDefaultTags, query]);
    const x = useAPIPostData<QueryResultsBody, string[]>(
        "/queries/results",
        body,
    );

    return {
        matchedSongIds: body ? (x.data ?? []) : [],
        queryResultsLoading: body !== null && x.isLoading,
        queryResultsErr: x.error,
    };
}
