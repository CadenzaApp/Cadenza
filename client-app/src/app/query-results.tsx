import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import QueryResults from "@/features/query-builder/QueryResults";
import type { AdvancedQueryJSON } from "@/features/advanced-query-builder/types";
import type { QueryJSONNode } from "@/features/query-builder/types";
import { useAllTracksFromLibrary } from "@/lib/musickit-hooks";
import { useAdvancedQueryResults, useQueryResults } from "@/lib/routes/queries";

/** Full-screen query matches, presented like the album and playlist heroes. */
export default function QueryResultsScreen() {
    const { builder, query: encodedQuery } = useLocalSearchParams<{
        builder?: string;
        query?: string;
    }>();
    const isAdvanced = builder === "advanced";
    const query = useMemo(() => parseQuery(encodedQuery), [encodedQuery]);
    const simpleQuery = isAdvanced ? null : (query as QueryJSONNode | null);
    const advancedQuery = isAdvanced
        ? (query as AdvancedQueryJSON | null)
        : null;
    const {
        allLibraryTracks,
        allLibraryTracksLoading,
        allLibraryTracksErr,
        isLibraryConnected,
    } = useAllTracksFromLibrary();
    const candidateSongIds = useMemo(
        () => allLibraryTracks.map((track) => track.catalogId ?? track.id),
        [allLibraryTracks],
    );
    const simpleResults = useQueryResults(
        simpleQuery,
        candidateSongIds,
        isLibraryConnected && !allLibraryTracksLoading && !allLibraryTracksErr,
    );
    const advancedResults = useAdvancedQueryResults(advancedQuery);
    const matchedSongIds = isAdvanced
        ? advancedResults.matchedSongIds
        : simpleResults.matchedSongIds;
    const queryResultsLoading = isAdvanced
        ? advancedResults.advancedQueryResultsLoading
        : simpleResults.queryResultsLoading;
    const queryResultsErr = isAdvanced
        ? advancedResults.advancedQueryResultsErr
        : simpleResults.queryResultsErr;
    const matchedSongs = useMemo(() => {
        const tracksByQueryId = new Map(
            allLibraryTracks.map((track) => [
                track.catalogId ?? track.id,
                track,
            ]),
        );
        return matchedSongIds.flatMap((id) => {
            const track = tracksByQueryId.get(id);
            return track ? [track] : [];
        });
    }, [allLibraryTracks, matchedSongIds]);

    return (
        <QueryResults
            songs={matchedSongs}
            isLoading={queryResultsLoading || allLibraryTracksLoading}
            error={queryResultsErr ?? allLibraryTracksErr}
            anticipatedTrackCount={matchedSongIds.length}
        />
    );
}

function parseQuery(encodedQuery?: string): unknown | null {
    if (!encodedQuery) return null;
    try {
        return JSON.parse(encodedQuery) as unknown;
    } catch {
        return null;
    }
}
