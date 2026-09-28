import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import QueryResults from "@/features/query-builder/QueryResults";
import { useTracksForSongIds } from "@/lib/musickit-hooks";
import type { QueryJSON } from "@/lib/query-json";
import { useQueryResults } from "@/lib/routes/queries";
import { useActivityTagIdsInQuery } from "@/lib/routes/tags";

/** Full-screen query matches, presented like the album and playlist heroes. */
export default function QueryResultsScreen() {
    const {
        query: encodedQuery,
        suggested,
        relevantTags,
    } = useLocalSearchParams<{
        query?: string;
        /** "1" when the builder had Include suggested tags on. */
        suggested?: string;
        relevantTags?: string;
    }>();
    const query = useMemo(() => parseQuery(encodedQuery), [encodedQuery]);
    const mostRelevantTags = useMemo(
        () => parseRelevantTags(relevantTags),
        [relevantTags],
    );
    const activityTagIds = useActivityTagIdsInQuery(query);
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
            mostRelevantTags={mostRelevantTags}
            activityTagIds={activityTagIds}
        />
    );
}

function parseRelevantTags(encoded?: string): string[] {
    if (!encoded) return [];
    try {
        const value: unknown = JSON.parse(encoded);
        return Array.isArray(value)
            ? value.filter((name): name is string => typeof name === "string")
            : [];
    } catch {
        return [];
    }
}

function parseQuery(encodedQuery?: string): QueryJSON | null {
    if (!encodedQuery) return null;
    try {
        return JSON.parse(encodedQuery) as QueryJSON;
    } catch {
        return null;
    }
}
