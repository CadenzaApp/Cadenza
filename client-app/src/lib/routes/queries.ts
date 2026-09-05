import { QueryJSONNode } from "@/features/query-builder/types";
import { useAPIData, useAPIFetch } from "../api-actions";

export function useQueryResults() {
    const x = useAPIFetch<{ q: string }, string[]>("/queries/results");

    return {
        matchedSongIds: x.data,
        getQueryResults: (jsonQuery: QueryJSONNode) =>
            x.trigger({ q: JSON.stringify(jsonQuery) }),
        queryResultsLoading: x.isMutating,
        queryResultsErr: x.error,
        resetQuery: x.reset,
    };
}
