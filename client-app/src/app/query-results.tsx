import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import QueryResults from "@/features/query-builder/QueryResults";
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import type { QueryJSON } from "@/lib/query-json";
import { useQueryResults } from "@/lib/routes/queries";

/** Full-screen query matches, presented like the album and playlist heroes. */
export default function QueryResultsScreen() {
    const { query: encodedQuery, suggested } = useLocalSearchParams<{
        query?: string;
        /** "1" when the builder had Include suggested tags on. */
        suggested?: string;
    }>();
    const query = useMemo(() => parseQuery(encodedQuery), [encodedQuery]);
    const { matchedSongIds, queryResultsLoading, queryResultsErr } =
        useQueryResults(query, suggested === "1");
    const { tracks, tracksLoading, tracksErr } =
        useTracksForSongIds(matchedSongIds);

    return (
        <QueryResults
            songs={tracks}
            isLoading={queryResultsLoading || tracksLoading}
            error={queryResultsErr ?? tracksErr}
            anticipatedTrackCount={matchedSongIds.length}
        />
    );
}

function parseQuery(encodedQuery?: string): QueryJSON | null {
    if (!encodedQuery) return null;
    try {
        return JSON.parse(encodedQuery) as QueryJSON;
    } catch {
        return null;
    }
}
