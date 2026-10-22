import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";

import QueryResults from "@/features/query-builder/QueryResults";
import { useArrangedTrackList } from "@/lib/arranged-track-list";
import { useTrackLookup } from "@/lib/musickit-hooks";
import { encodeQuerySource, type PlaySource } from "@/lib/play-source";
import type { QueryJSON } from "@/lib/query-json";
import type { ArrangeSource } from "@/lib/routes/arrange";
import { useActivityTagIdsInQuery } from "@/lib/routes/tags";
import { useSavedArrangement } from "@/lib/saved-arrangement";
import { queryQueueIds } from "@/lib/paged-tracks";
import { NO_ARRANGEMENT } from "@/lib/song-arrangement";

/** Full-screen query matches, presented like the album and playlist heroes. */
export default function QueryResultsScreen() {
    const {
        query: encodedQuery,
        suggested,
        library,
        relevantTags,
        name,
    } = useLocalSearchParams<{
        query?: string;
        /** "1" when the builder had Include suggested tags on. */
        suggested?: string;
        /** "1" when Show songs only in your library was on. */
        library?: string;
        relevantTags?: string;
        /** The query as one readable line, for the analytics ranking. */
        name?: string;
    }>();
    const query = useMemo(() => parseQuery(encodedQuery), [encodedQuery]);
    const libraryOnly = library === "1";
    const considerDefaultTags = suggested === "1";
    const { arrangement, setArrangement, ready } =
        useSavedArrangement("query-results");
    // what a play from here is credited to
    const playSource = useMemo<PlaySource | undefined>(
        () =>
            query
                ? {
                      kind: "query",
                      id: encodeQuerySource({
                          query,
                          suggested: considerDefaultTags,
                      }),
                      name: name || "Query",
                  }
                : undefined,
        [considerDefaultTags, name, query],
    );
    const mostRelevantTags = useMemo(
        () => parseRelevantTags(relevantTags),
        [relevantTags],
    );
    const activityTagIds = useActivityTagIdsInQuery(query);
    // held for as long as the screen is open, so the list cannot move while it
    // is scrolled. a new sort or group asks for a new one. waits for the saved
    // arrangement, so a sorted screen is not fetched unsorted first
    const source = useMemo<ArrangeSource | null>(
        () =>
            query && ready
                ? { kind: "query", query, considerDefaultTags, libraryOnly }
                : null,
        [considerDefaultTags, libraryOnly, query, ready],
    );
    const lookupTracks = useTrackLookup();
    const resetArrangement = useCallback(
        () => setArrangement(NO_ARRANGEMENT),
        [setArrangement],
    );
    const list = useArrangedTrackList({
        source,
        arrangement,
        lookupTracks,
        onRejected: resetArrangement,
    });
    const { arranged, loadedCount, resolveTracks, shownTracks, songs } = list;
    // unsorted, every song that is certainly the user's own plays, scrolled to
    // or not, and the rest once the list has shown them. sorted or grouped,
    // what the list has shown
    const resolvePlayQueue = useCallback(
        async () =>
            arranged
                ? shownTracks
                : resolveTracks(queryQueueIds(songs, loadedCount)),
        [arranged, loadedCount, resolveTracks, shownTracks, songs],
    );

    return (
        <QueryResults
            songs={list.sections ? list.shownTracks : list.tracks}
            isLoading={!ready || list.loading}
            error={list.error}
            matchCount={list.songIds.length}
            capped={list.capped}
            libraryOnly={libraryOnly}
            pagination={list.pagination}
            sections={list.sections}
            arrangement={{ value: arrangement, onChange: setArrangement }}
            resolvePlayQueue={resolvePlayQueue}
            mostRelevantTags={mostRelevantTags}
            activityTagIds={activityTagIds}
            playSource={playSource}
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
