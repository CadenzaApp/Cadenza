import type { MusicItem } from "@apple-musickit";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCollectionArtworkTint } from "@/components/custom/use-collection-artwork-tint";
import QueryResults, {
    type QueryResultsActions,
} from "@/features/query-builder/QueryResults";
import {
    COVER_SONG_COUNT,
    useArrangedTrackList,
} from "@/lib/arranged-track-list";
import { usePagedTracksForSongIds, useTrackLookup } from "@/lib/musickit-hooks";
import { queryQueueIds } from "@/lib/paged-tracks";
import { encodeQuerySource, type PlaySource } from "@/lib/play-source";
import type { QueryJSON } from "@/lib/query-json";
import type { ArrangeSource } from "@/lib/routes/arrange";
import {
    useRerunSavedQuery,
    useSavedQuery,
    useSavedQuerySongs,
    useSaveQuery,
    useUpdateSavedQuery,
} from "@/lib/routes/saved-queries";
import { useActivityTagIdsInQuery } from "@/lib/routes/tags";
import {
    isArranged,
    NO_ARRANGEMENT,
    type SongArrangement,
} from "@/lib/song-arrangement";

/**
 * Full-screen query matches, presented like the album and playlist heroes.
 *
 * Two modes. Opened from the query builder it runs the query live. Opened with
 * `saved` it shows the songs that saved query holds, which only change when it
 * is rerun (or by tagging, with the Update saved queries setting on). Saving a
 * live query from the menu keeps showing the live list, since it is what was
 * just saved.
 */
export default function QueryResultsScreen() {
    const params = useLocalSearchParams<{
        query?: string;
        /** "1" when the builder had Include suggested tags on. */
        suggested?: string;
        /** "1" when Show songs only in library or tagged was on. */
        library?: string;
        relevantTags?: string;
        /** The query as one readable line, or a saved query's name. */
        name?: string;
        /** A saved query's id, to show its stored songs. */
        saved?: string;
    }>();
    const openedSavedId = parseSavedId(params.saved);
    // a live query saved from here
    const [savedHereId, setSavedHereId] = useState<number | null>(null);
    const savedId = openedSavedId ?? savedHereId;
    const { savedQuery } = useSavedQuery(savedId);
    const { savedSongs, savedSongsLoaded, savedSongsErr } =
        useSavedQuerySongs(openedSavedId);

    const paramQuery = useMemo(() => parseQuery(params.query), [params.query]);
    const query = paramQuery ?? savedQuery?.query ?? null;
    const libraryOrTagged = savedQuery
        ? savedQuery.library_or_tagged
        : params.library === "1";
    const considerDefaultTags = savedQuery
        ? savedQuery.consider_default_tags
        : params.suggested === "1";
    const name = savedQuery?.name ?? params.name;

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
        () => parseRelevantTags(params.relevantTags),
        [params.relevantTags],
    );
    const activityTagIds = useActivityTagIdsInQuery(query);

    // held for as long as the screen is open, so the list cannot move while it
    // is scrolled. a new sort or group asks for a new one, and so does a saved
    // query's new songs after a rerun
    const savedIds = useMemo(
        () => savedSongs.map((song) => song.songId),
        [savedSongs],
    );
    const source = useMemo<ArrangeSource | null>(() => {
        if (openedSavedId !== null) {
            return savedSongsLoaded
                ? { kind: "songs", songIds: savedIds }
                : null;
        }
        return paramQuery
            ? {
                  kind: "query",
                  query: paramQuery,
                  considerDefaultTags,
                  scope: libraryOrTagged ? "libraryOrTagged" : "everything",
              }
            : null;
    }, [
        considerDefaultTags,
        libraryOrTagged,
        openedSavedId,
        paramQuery,
        savedIds,
        savedSongsLoaded,
    ]);
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
    // a saved query left unsorted is a plain list of ids, which the arranged
    // list leaves to its caller, so its songs are paged in here
    const pagesSavedIds = openedSavedId !== null && !isArranged(arrangement);
    const savedPages = usePagedTracksForSongIds(savedIds, pagesSavedIds);
    const view: ListView = pagesSavedIds
        ? {
              tracks: savedPages.tracks,
              shownTracks: savedPages.tracks,
              sections: null,
              cover: null,
              loading: !savedSongsLoaded || savedPages.tracksLoading,
              error: savedPages.tracksErr,
              pagination: {
                  hasNextPage: savedPages.hasNextPage,
                  isLoadingNextPage: savedPages.isLoadingNextPage,
                  onLoadNextPage: savedPages.loadNextPage,
              },
              loadedCount: savedPages.loadedCount,
              resolveTracks: savedPages.resolveTracks,
          }
        : list;
    const { arranged } = list;
    const { loadedCount, resolveTracks, shownTracks } = view;
    // a saved query knows which of its songs were the user's own
    const songs = openedSavedId !== null ? savedSongs : list.songs;
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

    const coverSongs = useHeldCover(view, source);
    const computedCover = useCollectionArtworkTint(coverSongs);
    // a saved query keeps the cover it was saved with
    const storedArtwork = savedQuery?.artwork_urls ?? null;
    const artworkUrls = storedArtwork?.length
        ? storedArtwork
        : computedCover.artworkUrls;
    const actions = useQueryActions({
        savedId,
        favorite: savedQuery?.favorite ?? false,
        shared: savedQuery?.shared ?? false,
        query,
        considerDefaultTags,
        libraryOrTagged,
        coverUrls: computedCover.artworkUrls,
        coverSettled: coverSongs.length > 0 && !view.loading,
        storedArtwork,
        onSaved: setSavedHereId,
    });

    return (
        <QueryResults
            songs={view.sections ? view.shownTracks : view.tracks}
            artworkUrls={artworkUrls}
            tint={computedCover.tint}
            isLoading={view.loading || (openedSavedId !== null && !source)}
            error={view.error ?? savedSongsErr}
            matchCount={
                openedSavedId !== null ? savedSongs.length : list.songIds.length
            }
            capped={openedSavedId === null && list.capped}
            libraryOrTagged={libraryOrTagged}
            pagination={view.pagination}
            sections={view.sections}
            arrangement={{
                value: arrangement,
                onChange: setArrangement,
                sortValues: list.sortValues,
            }}
            resolvePlayQueue={resolvePlayQueue}
            mostRelevantTags={mostRelevantTags}
            activityTagIds={activityTagIds}
            playSource={playSource}
            actions={query ? actions : undefined}
        />
    );
}

/**
 * What the screen draws from: the arranged list, or a saved query's ids paged
 * in order.
 */
type ListView = Pick<
    ReturnType<typeof useArrangedTrackList>,
    | "tracks"
    | "shownTracks"
    | "sections"
    | "cover"
    | "loading"
    | "error"
    | "pagination"
    | "loadedCount"
    | "resolveTracks"
>;

/**
 * The cover songs: the first songs of the result, open groups or not, held for
 * as long as the screen shows this source, so opening a group or a new sort
 * never repaints the page.
 */
function useHeldCover(list: ListView, source: ArrangeSource | null) {
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
    return cover?.source === source ? cover.tracks : candidates;
}

/**
 * The menu's writes. Saving sends the cover on show. After a rerun, and for a
 * query saved before covers were, the cover is sent again once the new songs'
 * cover settles.
 */
function useQueryActions({
    savedId,
    favorite,
    shared,
    query,
    considerDefaultTags,
    libraryOrTagged,
    coverUrls,
    coverSettled,
    storedArtwork,
    onSaved,
}: {
    savedId: number | null;
    favorite: boolean;
    shared: boolean;
    query: QueryJSON | null;
    considerDefaultTags: boolean;
    libraryOrTagged: boolean;
    coverUrls: readonly string[];
    coverSettled: boolean;
    /** Null until the saved query has loaded. */
    storedArtwork: readonly string[] | null;
    onSaved: (savedId: number) => void;
}): QueryResultsActions {
    const { saveQuery } = useSaveQuery();
    const { updateSavedQuery } = useUpdateSavedQuery();
    const { rerunSavedQuery } = useRerunSavedQuery();
    const [coverStale, setCoverStale] = useState(false);
    // the last cover sent, so one already on its way is not sent again
    const sentCover = useRef<string | null>(null);

    const needsCover =
        savedId !== null &&
        storedArtwork !== null &&
        coverSettled &&
        coverUrls.length > 0 &&
        (coverStale || storedArtwork.length === 0);
    useEffect(() => {
        if (!needsCover || savedId === null) return;
        const key = JSON.stringify([savedId, coverUrls]);
        if (sentCover.current === key) return;
        sentCover.current = key;
        setCoverStale(false);
        void (async () => {
            try {
                await updateSavedQuery({
                    saved_query_id: savedId,
                    artwork_urls: coverUrls,
                });
            } catch (error) {
                console.error("Could not store the query cover.", error);
            }
        })();
    }, [coverUrls, needsCover, savedId, updateSavedQuery]);

    return {
        saved: savedId === null ? null : { favorite, shared },
        save: async (name, favoriteOnSave) => {
            if (!query) return;
            const saved = await saveQuery({
                name,
                query,
                consider_default_tags: considerDefaultTags,
                library_or_tagged: libraryOrTagged,
                favorite: favoriteOnSave,
                artwork_urls: coverUrls,
            });
            onSaved(saved.saved_query_id);
        },
        setFavorite: async (nextFavorite) => {
            if (savedId === null) return;
            await updateSavedQuery({
                saved_query_id: savedId,
                favorite: nextFavorite,
            });
        },
        setShared: async (nextShared) => {
            if (savedId === null) return;
            await updateSavedQuery({
                saved_query_id: savedId,
                shared: nextShared,
            });
        },
        rerun: async () => {
            if (savedId === null) return;
            await rerunSavedQuery({ saved_query_id: savedId });
            // the new songs bring a new cover once they show
            setCoverStale(true);
        },
    };
}

function parseSavedId(value?: string): number | null {
    const id = Number(value);
    return value && Number.isInteger(id) && id > 0 ? id : null;
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
