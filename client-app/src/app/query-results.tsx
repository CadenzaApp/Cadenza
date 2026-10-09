import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import type { MusicListSort } from "@/components/custom/music-list";
import QueryResults from "@/features/query-builder/QueryResults";
import { usePagedTracksForSongIds } from "@/lib/musickit-hooks";
import { queryQueueIds } from "@/lib/paged-tracks";
import { encodeQuerySource, type PlaySource } from "@/lib/play-source";
import type { QueryJSON } from "@/lib/query-json";
import {
    useQueryResultsSnapshot,
    type QueryResultsSort,
} from "@/lib/routes/queries";
import { useActivityTagIdsInQuery } from "@/lib/routes/tags";

/** What the list opens sorted by, the same as every other song list. */
const DEFAULT_SORT: MusicListSort = { option: "title", direction: "ascending" };

/** Full-screen query matches, presented like the album and playlist heroes. */
export default function QueryResultsScreen() {
    const {
        query: encodedQuery,
        suggested,
        relevantTags,
        name,
    } = useLocalSearchParams<{
        query?: string;
        /** "1" when the builder had Include suggested tags on. */
        suggested?: string;
        relevantTags?: string;
        /** The query as one readable line, for the analytics ranking. */
        name?: string;
    }>();
    const query = useMemo(() => parseQuery(encodedQuery), [encodedQuery]);
    const [sort, setSort] = useState<MusicListSort>(DEFAULT_SORT);
    const resultsSort = useMemo(() => toResultsSort(sort), [sort]);
    // what a play from here is credited to
    const playSource = useMemo<PlaySource | undefined>(
        () =>
            query
                ? {
                      kind: "query",
                      id: encodeQuerySource({
                          query,
                          suggested: suggested === "1",
                      }),
                      name: name || "Query",
                  }
                : undefined,
        [name, query, suggested],
    );
    const mostRelevantTags = useMemo(
        () => parseRelevantTags(relevantTags),
        [relevantTags],
    );
    const activityTagIds = useActivityTagIdsInQuery(query);
    // held for as long as the screen is open, so the list cannot move while it
    // is scrolled. sorting asks for a new one
    const {
        matchedSongs,
        matchedSongIds,
        resultsCapped,
        queryResultsLoading,
        queryResultsErr,
    } = useQueryResultsSnapshot(query, suggested === "1", resultsSort);
    const {
        tracks,
        loadedCount,
        tracksLoading,
        isLoadingNextPage,
        hasNextPage,
        loadNextPage,
        resolveTracks,
        tracksErr,
    } = usePagedTracksForSongIds(matchedSongIds);
    // every song that is certainly the user's own plays, scrolled to or not.
    // the rest only once the list has shown them
    const resolvePlayQueue = useCallback(
        () => resolveTracks(queryQueueIds(matchedSongs, loadedCount)),
        [loadedCount, matchedSongs, resolveTracks],
    );

    return (
        <QueryResults
            songs={tracks}
            isLoading={queryResultsLoading || tracksLoading}
            error={queryResultsErr ?? tracksErr}
            matchCount={matchedSongIds.length}
            capped={resultsCapped}
            pagination={{
                hasNextPage,
                isLoadingNextPage,
                onLoadNextPage: loadNextPage,
            }}
            sort={sort}
            onSortChange={setSort}
            resolvePlayQueue={resolvePlayQueue}
            mostRelevantTags={mostRelevantTags}
            activityTagIds={activityTagIds}
            playSource={playSource}
        />
    );
}

/** The list's sort as the backend takes it. The list only offers these three. */
function toResultsSort(sort: MusicListSort): QueryResultsSort {
    return {
        key: sort.option === "dateAdded" ? "title" : sort.option,
        direction: sort.direction,
    };
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
