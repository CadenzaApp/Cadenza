import { useMemo } from "react";

import type { QueryJSON } from "@/lib/query-json";
import { useAPIPostData } from "../api-actions";
import { useUserSettings } from "./settings";

/**
 * One matching song. `certain` is true for a song in the user's library or
 * carrying one of their own tags, and false for a song Cadenza knows from
 * elsewhere.
 */
export type QueryResultSong = { songId: string; certain: boolean };

type QueryResultsBody = {
    query: QueryJSON;
    consider_default_tags: boolean;
    library_only?: true;
    hide_explicit?: true;
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
 * include the shared default tags. `libraryOnly` narrows the songs to the
 * user's library, so every match is their own and nothing is capped. Both are
 * part of the cache key, so turning one on and off refetches rather than
 * reusing the other answer. The user's Hide explicit content setting is sent
 * the same way.
 *
 * Revalidates like any other read, so it suits a live preview. A list the user
 * scrolls through wants `useArrangedSongs` from `./arrange`, which holds its
 * answer and can sort and group it.
 */
export function useQueryResults(
    query: QueryJSON | null,
    considerDefaultTags: boolean,
    libraryOnly: boolean,
) {
    const { body, waiting } = useQueryResultsBody(
        query,
        considerDefaultTags,
        libraryOnly,
    );
    const x = useAPIPostData<QueryResultsBody, QueryResultsResponse>(
        "/queries/results",
        body,
    );
    return {
        ...useParsedResults(
            body,
            x.data,
            waiting || (body !== null && x.isLoading),
            x.error,
        ),
        refreshQueryResults: x.mutate,
    };
}

function useQueryResultsBody(
    query: QueryJSON | null,
    considerDefaultTags: boolean,
    libraryOnly: boolean,
) {
    const { settings, settingsReady } = useUserSettings();
    const hideExplicit = settings.hide_explicit;
    // no request until the setting is known, or a cold start would run the
    // query twice and show explicit songs in between
    const waiting = query !== null && !settingsReady;
    const body = useMemo<QueryResultsBody | null>(() => {
        if (!query || waiting) return null;
        return {
            query,
            consider_default_tags: considerDefaultTags,
            // left out when off, so the usual request and its cache key stay
            // the same as before the setting existed
            ...(libraryOnly ? { library_only: true as const } : {}),
            ...(hideExplicit ? { hide_explicit: true as const } : {}),
        };
    }, [considerDefaultTags, hideExplicit, libraryOnly, query, waiting]);
    return { body, waiting };
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
        queryResultsLoading: isLoading,
        // an empty query has nothing to fail, whatever the last key left behind
        queryResultsErr: body ? error : undefined,
    };
}
