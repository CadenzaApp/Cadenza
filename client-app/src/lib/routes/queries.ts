import { useMemo } from "react";

import type { AdvancedQueryJSON } from "@/features/advanced-query-builder/types";
import type { QueryJSONNode } from "@/features/query-builder/types";
import { useAPIData, useAPIPostData } from "../api-actions";

type QueryResultsBody = {
    query: QueryJSONNode;
    song_ids: string[];
};

export function useQueryResults(
    query: QueryJSONNode | null,
    candidateSongIds: readonly string[],
    candidatesReady: boolean,
) {
    const body = useMemo<QueryResultsBody | null>(() => {
        if (!query || !candidatesReady) return null;
        return {
            query,
            song_ids: [...new Set(candidateSongIds.filter(Boolean))],
        };
    }, [candidateSongIds, candidatesReady, query]);
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

export function useAdvancedQueryResults(query: AdvancedQueryJSON | null) {
    const x = useAPIData<string[]>("/queries/advanced/results", {
        q: query ? JSON.stringify(query) : null,
    });

    return {
        matchedSongIds: query ? (x.data ?? []) : [],
        advancedQueryResultsLoading: query !== null && x.isLoading,
        advancedQueryResultsErr: x.error,
    };
}
