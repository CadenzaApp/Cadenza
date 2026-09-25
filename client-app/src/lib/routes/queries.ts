import { useMemo } from "react";

import type { QueryJSON } from "@/lib/query-json";
import { useAPIPostData } from "../api-actions";

/** Stable reference so a query with no results does not rerender its readers. */
const NO_MATCHES: string[] = [];

type QueryResultsBody = {
    query: QueryJSON;
    consider_default_tags: boolean;
};

/**
 * Song ids matching `query`, most relevant first. Both builders compile to the
 * same wire format, so this is the only query hook.
 *
 * The backend runs the query over the user's library as it knows it, from the
 * `user_songs` table that `PATCH /songs` keeps in step with Apple Music. The
 * client no longer sends candidate song ids, so a query here is only as current
 * as the last library sync.
 *
 * `considerDefaultTags` widens what the backend counts as a tag on a song to
 * include the shared default tags. It is part of the cache key, so turning it on
 * and off refetches rather than reusing the other answer.
 */
export function useQueryResults(
    query: QueryJSON | null,
    considerDefaultTags: boolean,
) {
    const body = useMemo<QueryResultsBody | null>(() => {
        if (!query) return null;
        return {
            query,
            consider_default_tags: considerDefaultTags,
        };
    }, [considerDefaultTags, query]);
    const x = useAPIPostData<QueryResultsBody, string[]>(
        "/queries/results",
        body,
    );

    return {
        matchedSongIds: body ? (x.data ?? NO_MATCHES) : NO_MATCHES,
        queryResultsLoading: body !== null && x.isLoading,
        queryResultsErr: x.error,
    };
}
