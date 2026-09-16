import { QueryJSONNode } from "@/features/query-builder/types";
import { AdvancedQueryJSON } from "@/features/advanced-query-builder/types";
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

export function useAdvancedQueryResults() {
    const x = useAPIFetch<{ q: string }, string[]>(
        "/queries/advanced/results",
    );

    return {
        matchedSongIds: x.data,
        getAdvancedQueryResults: (query: AdvancedQueryJSON) =>
            x.trigger({ q: JSON.stringify(query) }),
        advancedQueryResultsLoading: x.isMutating,
        advancedQueryResultsErr: x.error,
        resetAdvancedQuery: x.reset,
    };
}
