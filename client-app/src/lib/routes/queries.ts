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

/**
 * Which songs a query runs over. `everything` is every song Cadenza knows.
 * `libraryOrTagged` is the user's library and every song carrying one of
 * their own tags, the songs the In My Library or Tagged activity tags hold
 * true for. `library` is the library alone. Either of the last two is the
 * user's own songs only, so nothing is capped.
 */
export type QuerySongScope = "everything" | "libraryOrTagged" | "library";

/**
 * The request fields for `scope`. Nothing for `everything`, so the usual
 * request and its cache key stay the same as before the settings existed.
 */
export function songScopeBody(scope: QuerySongScope) {
    switch (scope) {
        case "library":
            return { library_only: true as const };
        case "libraryOrTagged":
            return { library_or_tagged: true as const };
        case "everything":
            return {};
    }
}

type QueryResultsBody = {
    query: QueryJSON;
    consider_default_tags: boolean;
    library_only?: true;
    library_or_tagged?: true;
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
 * include the shared default tags. `scope` narrows the songs (see
 * `QuerySongScope`); narrowed, every match is the user's own and nothing is
 * capped. Both are
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
    scope: QuerySongScope,
) {
    const { body, waiting } = useQueryResultsBody(
        query,
        considerDefaultTags,
        scope,
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
    scope: QuerySongScope,
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
            ...songScopeBody(scope),
            ...(hideExplicit ? { hide_explicit: true as const } : {}),
        };
    }, [considerDefaultTags, hideExplicit, query, scope, waiting]);
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
