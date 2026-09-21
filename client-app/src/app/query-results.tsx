import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import QueryResults from "@/features/query-builder/QueryResults";
import { useAllTracksFromLibrary } from "@/lib/musickit-hooks";
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
    const { matchedSongIds, queryResultsLoading, queryResultsErr } =
        useQueryResults(
            query,
            candidateSongIds,
            isLibraryConnected &&
                !allLibraryTracksLoading &&
                !allLibraryTracksErr,
            suggested === "1",
        );
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

function parseQuery(encodedQuery?: string): QueryJSON | null {
    if (!encodedQuery) return null;
    try {
        return JSON.parse(encodedQuery) as QueryJSON;
    } catch {
        return null;
    }
}
