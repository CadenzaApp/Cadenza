import { useMemo } from "react";

import type { QueryJSON } from "@/lib/query-json";

import {
    fetchAPIData,
    useAPIData,
    useAPIMutation,
    type APIDataEndpoint,
} from "../api-actions";
import type { QueryResultSong } from "./queries";

/**
 * A query the user saved by name, listed under Queries in the Library tab. It
 * holds the songs it matched when it was saved or last rerun, not a live
 * result.
 */
export type SavedQuery = {
    saved_query_id: number;
    name: string;
    query: QueryJSON;
    /** The builder's Include suggested tags setting when it was saved. */
    consider_default_tags: boolean;
    /** The builder's library or tagged setting when it was saved. */
    library_or_tagged: boolean;
    /** Pinned to the top of the Queries list. */
    favorite: boolean;
    /** The cover the results screen showed, up to 4. */
    artwork_urls: string[];
    song_count: number;
    created_at: string;
    songs_stored_at: string | null;
};

type NewSavedQuery = {
    name: string;
    query: QueryJSON;
    consider_default_tags: boolean;
    library_or_tagged: boolean;
    favorite?: boolean;
    artwork_urls?: readonly string[];
};

type SavedQueryPatch = {
    saved_query_id: number;
    name?: string;
    favorite?: boolean;
    artwork_urls?: readonly string[];
};

type SavedQuerySongsResponse = {
    songs: { song_id: string; certain: boolean }[];
};

const SAVED_QUERIES_PATH = "/saved-queries";
const NO_SONGS: QueryResultSong[] = [];

function songsPath(savedQueryId: number) {
    return `${SAVED_QUERIES_PATH}/${savedQueryId}/songs`;
}

/** Every read a change to one saved query can move. */
function savedQueryReads(savedQueryId?: number): APIDataEndpoint[] {
    return [
        { path: SAVED_QUERIES_PATH },
        ...(savedQueryId === undefined
            ? []
            : [{ path: songsPath(savedQueryId) }]),
    ];
}

/** Every query the user saved, favorites first, then newest first. */
export function useSavedQueries(enabled = true) {
    const x = useAPIData<SavedQuery[]>(SAVED_QUERIES_PATH, undefined, {
        enabled,
    });

    return {
        savedQueries: x.data,
        savedQueriesLoading: x.isLoading,
        savedQueriesErr: x.error,
    };
}

/** One saved query, read off the list. */
export function useSavedQuery(savedQueryId: number | null) {
    const { savedQueries, savedQueriesLoading, savedQueriesErr } =
        useSavedQueries(savedQueryId !== null);
    const savedQuery = useMemo(
        () =>
            savedQueries?.find(
                (saved) => saved.saved_query_id === savedQueryId,
            ) ?? null,
        [savedQueries, savedQueryId],
    );
    return {
        savedQuery,
        savedQueryLoading: savedQueriesLoading,
        savedQueryErr: savedQueriesErr,
    };
}

/** The songs a saved query holds, in order. */
export function useSavedQuerySongs(savedQueryId: number | null) {
    const x = useAPIData<SavedQuerySongsResponse>(
        savedQueryId === null ? SAVED_QUERIES_PATH : songsPath(savedQueryId),
        undefined,
        { enabled: savedQueryId !== null },
    );
    const songs = useMemo(
        () =>
            x.data
                ? x.data.songs.map((song) => ({
                      songId: song.song_id,
                      certain: song.certain,
                  }))
                : NO_SONGS,
        [x.data],
    );

    return {
        savedSongs: songs,
        savedSongsLoaded: x.data !== undefined,
        savedSongsErr: x.error,
    };
}

/** The songs a saved query holds, read once outside the cache, for queueing. */
export async function fetchSavedQuerySongs(
    savedQueryId: number,
): Promise<QueryResultSong[]> {
    const response = await fetchAPIData<SavedQuerySongsResponse>(
        songsPath(savedQueryId),
    );
    return response.songs.map((song) => ({
        songId: song.song_id,
        certain: song.certain,
    }));
}

/** Saves a query and the songs it matches now. */
export function useSaveQuery() {
    const x = useAPIMutation<NewSavedQuery, SavedQuery>(
        "POST",
        SAVED_QUERIES_PATH,
        savedQueryReads(),
    );
    return {
        saveQuery: x.trigger,
        saveQueryLoading: x.isMutating,
        saveQueryErr: x.error,
        resetSaveQuery: x.reset,
    };
}

// named, since a mutation keys itself on its path function's name
function savedQueryPath({ saved_query_id }: { saved_query_id: number }) {
    return `${SAVED_QUERIES_PATH}/${saved_query_id}`;
}

function rerunPath({ saved_query_id }: { saved_query_id: number }) {
    return `${SAVED_QUERIES_PATH}/${saved_query_id}/rerun`;
}

/** Renames, favorites, or sets the cover of a saved query. */
export function useUpdateSavedQuery() {
    const x = useAPIMutation<SavedQueryPatch, SavedQuery>(
        "PATCH",
        savedQueryPath,
        () => savedQueryReads(),
    );
    return {
        updateSavedQuery: x.trigger,
        updateSavedQueryLoading: x.isMutating,
        updateSavedQueryErr: x.error,
    };
}

/**
 * Runs a saved query again the way it was saved and replaces its songs with
 * what it matches now.
 */
export function useRerunSavedQuery() {
    const x = useAPIMutation<{ saved_query_id: number }, SavedQuery>(
        "POST",
        rerunPath,
        ({ saved_query_id }) => savedQueryReads(saved_query_id),
        { invalidation: "await" },
    );
    return {
        rerunSavedQuery: x.trigger,
        rerunSavedQueryLoading: x.isMutating,
        rerunSavedQueryErr: x.error,
    };
}

export function useDeleteSavedQuery() {
    const x = useAPIMutation<{ saved_query_id: number }, null>(
        "DELETE",
        savedQueryPath,
        () => savedQueryReads(),
    );
    return {
        deleteSavedQuery: x.trigger,
        deleteSavedQueryLoading: x.isMutating,
        deleteSavedQueryErr: x.error,
        resetDeleteSavedQuery: x.reset,
    };
}

export function saveQueryErrorMessage(error: unknown) {
    if (
        typeof error === "object" &&
        error !== null &&
        "error_type" in error &&
        error.error_type === "QueryNameAlreadyTaken"
    ) {
        return "You already have a saved query with that name.";
    }

    return "Couldn't save this query. Please try again.";
}
