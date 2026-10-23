import type { MusicItem } from "@apple-musickit";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import QueryResults from "@/features/query-builder/QueryResults";
import {
    COVER_SONG_COUNT,
    useArrangedTrackList,
} from "@/lib/arranged-track-list";
import { useTrackLookup } from "@/lib/musickit-hooks";
import { encodeQuerySource, type PlaySource } from "@/lib/play-source";
import type { QueryJSON } from "@/lib/query-json";
import type { ArrangeSource } from "@/lib/routes/arrange";
import { useActivityTagIdsInQuery } from "@/lib/routes/tags";
import { queryQueueIds } from "@/lib/paged-tracks";
import { NO_ARRANGEMENT, type SongArrangement } from "@/lib/song-arrangement";

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
    // starts unsorted every time the screen opens, and is never saved
    const [arrangement, setArrangement] =
        useState<SongArrangement>(NO_ARRANGEMENT);
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
            query
                ? { kind: "query", query, considerDefaultTags, libraryOnly }
                : null,
        [considerDefaultTags, libraryOnly, query],
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
        // the rows show these, so a grouped list loads them with the songs
        warmActivityTags: activityTagIds.length > 0,
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

    // the cover and page color come from the first songs of the result, open
    // groups or not, and are held for as long as the screen shows this query:
    // opening a group, or a new sort or group, never repaints the page
    const shown = list.sections ? list.shownTracks : list.tracks;
    const candidates = list.cover?.tracks ?? shown;
    const firstSongsSettled = list.cover
        ? list.cover.ready && candidates.length > 0
        : shown.length >= COVER_SONG_COUNT ||
          (shown.length > 0 &&
              !list.loading &&
              !list.pagination?.isLoadingNextPage);
    const [cover, setCover] = useState<{
        source: ArrangeSource | null;
        tracks: MusicItem[];
    } | null>(null);
    // set while rendering, React's way of keeping a value from an earlier render
    if (firstSongsSettled && cover?.source !== source) {
        setCover({ source, tracks: candidates.slice(0, COVER_SONG_COUNT) });
    }
    const coverSongs = cover?.source === source ? cover.tracks : candidates;

    return (
        <QueryResults
            songs={shown}
            coverSongs={coverSongs}
            isLoading={list.loading}
            error={list.error}
            matchCount={list.songIds.length}
            capped={list.capped}
            libraryOnly={libraryOnly}
            pagination={list.pagination}
            sections={list.sections}
            arrangement={{
                value: arrangement,
                onChange: setArrangement,
                sortValues: list.sortValues,
            }}
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
