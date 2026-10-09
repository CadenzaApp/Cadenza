import { useMemo } from "react";

import type { QueryJSON } from "@/lib/query-json";
import { useAPIPostData, useAPIPostSnapshot } from "../api-actions";

/** What the results can be sorted by. Leaving it out sorts most relevant first. */
export type QueryResultsSort = {
    key: "title" | "artist" | "album";
    direction: "ascending" | "descending";
};

/**
 * One matching song. `certain` is true for a song in the user's library or
 * carrying one of their own tags, and false for a song Cadenza knows from
 * elsewhere.
 */
export type QueryResultSong = { songId: string; certain: boolean };

type QueryResultsBody = {
    query: QueryJSON;
    consider_default_tags: boolean;
    sort?: QueryResultsSort;
};

type QueryResultsResponse = {
    songs: { song_id: string; certain: boolean }[];
    capped: boolean;
};

/** Stable references so a query with no results does not rerender its readers. */
const NO_SONGS: QueryResultSong[] = [];
const NO_MATCHES: string[] = [];

/**
 * Songs matching `query`, in order. Both builders compile to the same wire
 * format, so this is the only query hook.
 *
 * The backend runs the query over every song Cadenza knows: the user's library
 * (from the `user_songs` table that `PATCH /songs` keeps in step with Apple
 * Music), every song carrying one of their tags, and every song whose Apple
 * Music metadata it has stored. Every match that is the user's own comes back.
 * Of the rest only the first 1000 do, and `resultsCapped` says when more
 * matched.
 *
 * `considerDefaultTags` widens what the backend counts as a tag on a song to
 * include the shared default tags. It is part of the cache key, so turning it on
 * and off refetches rather than reusing the other answer.
 *
 * Revalidates like any other read, so it suits a live preview. A list the user
 * scrolls through wants `useQueryResultsSnapshot`.
 */
export function useQueryResults(
    query: QueryJSON | null,
    considerDefaultTags: boolean,
) {
    const body = useQueryResultsBody(query, considerDefaultTags, null);
    const x = useAPIPostData<QueryResultsBody, QueryResultsResponse>(
        "/queries/results",
        body,
    );
    return useParsedResults(body, x.data, x.isLoading, x.error);
}

/**
 * The same results as `useQueryResults`, sorted by `sort`, but fetched once and
 * then held for as long as the caller stays mounted. Tagging or playing a song
 * changes what a query matches and how its songs rank, and a list that
 * refreshed under the user while they scrolled would skip or repeat rows. A new
 * query or sort fetches again.
 */
export function useQueryResultsSnapshot(
    query: QueryJSON | null,
    considerDefaultTags: boolean,
    sort: QueryResultsSort | null,
) {
    const body = useQueryResultsBody(query, considerDefaultTags, sort);
    const x = useAPIPostSnapshot<QueryResultsBody, QueryResultsResponse>(
        "/queries/results",
        body,
    );
    return useParsedResults(body, x.data, x.isLoading, x.error);
}

function useQueryResultsBody(
    query: QueryJSON | null,
    considerDefaultTags: boolean,
    sort: QueryResultsSort | null,
) {
    return useMemo<QueryResultsBody | null>(() => {
        if (!query) return null;
        return {
            query,
            consider_default_tags: considerDefaultTags,
            ...(sort ? { sort } : {}),
        };
    }, [considerDefaultTags, query, sort]);
}

function useParsedResults(
    body: QueryResultsBody | null,
    data: QueryResultsResponse | undefined,
    isLoading: boolean,
    error: unknown,
) {
    const response = body ? data : undefined;
    const matchedSongs = useMemo(
        () =>
            response
                ? response.songs.map((song) => ({
                      songId: song.song_id,
                      certain: song.certain,
                  }))
                : NO_SONGS,
        [response],
    );
    const matchedSongIds = useMemo(
        () => (response ? matchedSongs.map((song) => song.songId) : NO_MATCHES),
        [matchedSongs, response],
    );

    return {
        matchedSongs,
        matchedSongIds,
        resultsCapped: response?.capped ?? false,
        queryResultsLoading: body !== null && isLoading,
        queryResultsErr: error,
    };
}
