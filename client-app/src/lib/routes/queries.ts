import { useMemo } from "react";

import type { QueryJSONNode } from "@/features/query-builder/types";
import { useAPIPostData } from "../api-actions";

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
