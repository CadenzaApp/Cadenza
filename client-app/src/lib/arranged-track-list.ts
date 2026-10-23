import type { MusicItem } from "@apple-musickit";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
    MusicListPagination,
    MusicListSection,
    MusicListSections,
} from "@/components/custom/music-list";
import { reuseSections } from "@/components/custom/music-list/list-windows";

import {
    indexTracksById,
    useGroupedTrackLoader,
    usePagedTracksForSongIds,
} from "./musickit-hooks";
import { coverTracks, groupTracks, uniqueBy } from "./paged-tracks";
import {
    useArrangedSongs,
    type ArrangeSource,
    type TrackLookup,
} from "./routes/arrange";
import { useWarmRowTags } from "./routes/songs";
import { fieldKey, isArranged, type SongArrangement } from "./song-arrangement";

const NO_TRACKS: MusicItem[] = [];

type Options = {
    source: ArrangeSource | null;
    arrangement: SongArrangement;
    /** Finds tracks for the songs the backend has no metadata for. */
    lookupTracks: TrackLookup;
    /**
     * Every track of a list the phone already holds, like an album, so the
     * arranged ids are just put in order rather than looked up again.
     */
    localTracks?: readonly MusicItem[];
    /**
     * Called once when the backend refuses the arrangement, like a saved sort
     * by a tag that has since been deleted, so the caller can go back to None.
     */
    onRejected?: () => void;
    /** The rows show activity tags, so warm those as well as the user's tags. */
    warmActivityTags?: boolean;
};

/**
 * A song list the backend sorts and groups, made into what `MusicList` draws:
 * a flat list, or one header per group.
 *
 * A sorted or grouped query draws its rows from what the backend stores about
 * each song (`rowTracks`), so every row shows as soon as the list comes back,
 * without asking Apple. Only a song with no stored row, or a row stored
 * before artwork was kept, is looked up, in the background, top down and the
 * group opened last first (`useGroupedTrackLoader`), and kept, so opening or
 * closing a group never reloads anything. An unsorted query loads 50 songs at
 * a time from Apple as it scrolls. See `useArrangedSongs` for the fetch.
 *
 * `active` is false for a list of ids left unarranged, which the caller shows
 * in its own order.
 */
export function useArrangedTrackList({
    source,
    arrangement,
    lookupTracks,
    localTracks,
    onRejected,
    warmActivityTags = false,
}: Options) {
    const arranged = useArrangedSongs(source, arrangement, lookupTracks);
    const rejected = isRejection(arranged.error);
    useEffect(() => {
        if (rejected) onRejected?.();
    }, [onRejected, rejected]);
    const grouped = arranged.sections !== null;
    const local = localTracks !== undefined;
    // a sorted or grouped query: every row comes from the backend's stored rows
    const fromRows = !local && isArranged(arrangement);
    const { rowTracks } = arranged;

    // a list the phone holds needs nothing looked up
    const localTracksById = useMemo(
        () => (localTracks ? indexTracksById(localTracks) : null),
        [localTracks],
    );
    const paged = usePagedTracksForSongIds(
        local || fromRows ? NO_IDS : arranged.songIds,
        !local,
    );

    // which groups are open, and which was opened last. kept per grouping, so
    // a new sort, or the list fetched again, leaves them as they were. a new
    // grouping starts over with every group closed, until the user opens one
    const groupingKey = arrangement.group
        ? fieldKey(arrangement.group.field)
        : null;
    const [openState, setOpenState] = useState<{
        groupingKey: string | null;
        open: ReadonlySet<string>;
        lastOpened: string | null;
    }>({ groupingKey: null, open: NO_KEYS, lastOpened: null });
    const current =
        openState.groupingKey === groupingKey
            ? openState
            : {
                  groupingKey,
                  open: NO_KEYS,
                  lastOpened: null,
              };
    const openKeys = current.open;
    const onToggle = useCallback(
        (key: string) =>
            setOpenState((previous) => {
                const base =
                    previous.groupingKey === groupingKey
                        ? previous
                        : {
                              groupingKey,
                              open: NO_KEYS,
                              lastOpened: null,
                          };
                const open = new Set(base.open);
                const opening = !open.has(key);
                if (opening) open.add(key);
                else open.delete(key);
                return {
                    groupingKey,
                    open,
                    lastOpened: opening ? key : base.lastOpened,
                };
            }),
        [groupingKey],
    );

    // every song, walked once in group order from the group opened last, to
    // warm its tags and look up the few with no stored row or artwork. a flat
    // list is one group
    const groupIds = useMemo(
        () =>
            !fromRows
                ? null
                : arranged.sections
                  ? arranged.sections.map((section) => section.songIds)
                  : [arranged.songIds],
        [arranged.sections, arranged.songIds, fromRows],
    );
    const startGroup = Math.max(
        0,
        arranged.sections?.findIndex(
            (section) => section.key === current.lastOpened,
        ) ?? 0,
    );
    const warmRowTags = useWarmRowTags();
    const afterChunk = useCallback(
        (songIds: string[]) => warmRowTags(songIds, warmActivityTags),
        [warmActivityTags, warmRowTags],
    );
    // a stored row with artwork is all a row needs
    const known = useCallback(
        (songId: string) => rowTracks.get(songId)?.artworkUrl !== undefined,
        [rowTracks],
    );
    const loader = useGroupedTrackLoader({
        groups: groupIds,
        startGroup,
        enabled: fromRows,
        afterChunk,
        known,
    });
    // the stored row, unless it has no artwork and the library or Apple has
    // the song; then that, once it is in
    const loaderTrackFor = loader.trackFor;
    const loaderIsSettled = loader.isSettled;
    const trackFor = useCallback(
        (songId: string) => {
            const row = rowTracks.get(songId);
            if (row?.artworkUrl) return row;
            return loaderTrackFor(songId) ?? row;
        },
        [loaderTrackFor, rowTracks],
    );
    const isSettled = useCallback(
        (songId: string) => rowTracks.has(songId) || loaderIsSettled(songId),
        [loaderIsSettled, rowTracks],
    );

    const sections = useMemo<MusicListSection[] | null>(() => {
        if (!arranged.sections) return null;
        return arranged.sections.map((section) => {
            const expanded = openKeys.has(section.key);
            if (!expanded) {
                return {
                    key: section.key,
                    label: section.label,
                    count: section.count,
                    expanded,
                    tracks: NO_TRACKS,
                    isLoading: false,
                };
            }
            if (localTracksById) {
                return {
                    key: section.key,
                    label: section.label,
                    count: section.count,
                    expanded,
                    tracks: tracksFor(section.songIds, localTracksById),
                    isLoading: false,
                };
            }
            const { tracks, waiting } = groupTracks(
                section.songIds,
                trackFor,
                isSettled,
                (track) => track.id,
            );
            return {
                key: section.key,
                label: section.label,
                count: section.count,
                expanded,
                tracks,
                // a placeholder only for a group with nothing to show yet
                isLoading: waiting && tracks.length === 0,
            };
        });
    }, [arranged.sections, isSettled, localTracksById, openKeys, trackFor]);
    // the loader writes a few times a second while a list fills in, mostly
    // songs of groups that are closed. keep the groups as they were unless one
    // on show changed, so the list does not redraw for nothing
    const [heldSections, setHeldSections] = useState<
        readonly MusicListSection[] | null
    >(sections);
    const stableSections = reuseSections(heldSections, sections);
    if (stableSections !== heldSections) setHeldSections(stableSections);
    const listSections = useMemo<MusicListSections | null>(
        () => (stableSections ? { sections: stableSections, onToggle } : null),
        [onToggle, stableSections],
    );

    // flat: every stored row, a list the phone holds put in order, or the
    // paged tracks of an unsorted query
    const flatTracks = useMemo(() => {
        if (grouped) return NO_TRACKS;
        if (localTracksById) {
            return tracksFor(arranged.songIds, localTracksById);
        }
        if (fromRows) {
            return groupTracks(
                arranged.songIds,
                trackFor,
                isSettled,
                (track) => track.id,
            ).tracks;
        }
        return paged.tracks;
    }, [
        arranged.songIds,
        fromRows,
        grouped,
        isSettled,
        localTracksById,
        paged.tracks,
        trackFor,
    ]);

    // the cover: the first songs with artwork from the top of the list, open
    // or not. a song still being looked up may yet get artwork, so the cover
    // is only ready once those near the top are in
    const cover = useMemo(
        () =>
            fromRows
                ? coverTracks(
                      arranged.songIds,
                      trackFor,
                      (songId) =>
                          !arranged.loading &&
                          (loaderIsSettled(songId) ||
                              trackFor(songId)?.artworkUrl !== undefined),
                      COVER_SONG_COUNT,
                      COVER_SCAN,
                  )
                : null,
        [
            arranged.loading,
            arranged.songIds,
            fromRows,
            loaderIsSettled,
            trackFor,
        ],
    );

    /** A list the phone holds, every song in the arranged order. */
    const allLocalTracks = useMemo(
        () =>
            localTracksById && arranged.active
                ? tracksFor(arranged.songIds, localTracksById)
                : NO_TRACKS,
        [arranged.active, arranged.songIds, localTracksById],
    );

    /** Every song on show, in order: what Play and Shuffle queue when sorted. */
    const shownTracks = useMemo(
        () =>
            stableSections
                ? stableSections.flatMap((section) =>
                      section.expanded ? section.tracks : [],
                  )
                : flatTracks,
        [flatTracks, stableSections],
    );

    const pagination = useMemo<MusicListPagination | null>(
        () =>
            grouped || local || fromRows
                ? null
                : {
                      hasNextPage: paged.hasNextPage,
                      isLoadingNextPage: paged.isLoadingNextPage,
                      onLoadNextPage: paged.loadNextPage,
                  },
        [
            fromRows,
            grouped,
            local,
            paged.hasNextPage,
            paged.isLoadingNextPage,
            paged.loadNextPage,
        ],
    );

    return {
        active: arranged.active,
        arranged: isArranged(arrangement),
        songs: arranged.songs,
        songIds: arranged.songIds,
        capped: arranged.capped,
        /**
         * A sorted or grouped query's cover songs, from the top of the list
         * whatever is open, and whether they are final. Null otherwise, when
         * the cover comes from the rows on show.
         */
        cover,
        /** The flat list's tracks, all of them when sorted. Empty when grouped. */
        tracks: flatTracks,
        shownTracks,
        /** For a list the phone holds: all its songs, arranged. */
        allLocalTracks,
        sections: listSections,
        pagination,
        /** How many ids from the top the flat list has shown. */
        loadedCount: local
            ? arranged.songIds.length
            : fromRows
              ? flatTracks.length
              : paged.loadedCount,
        resolveTracks: paged.resolveTracks,
        loading:
            arranged.loading ||
            (!fromRows && !local && arranged.active && paged.tracksLoading),
        error:
            arranged.error ??
            (local ? undefined : fromRows ? loader.tracksErr : paged.tracksErr),
    };
}

const NO_IDS: string[] = [];
/** How many songs a cover shows, and how far down the list it looks for them. */
export const COVER_SONG_COUNT = 4;
const COVER_SCAN = 40;
const NO_KEYS: ReadonlySet<string> = new Set();

/** The backend refused the request as asked, which retrying will not change. */
function isRejection(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        (error as { status?: unknown }).status === 422
    );
}

/** The tracks for `songIds`, in order, each once. */
function tracksFor(
    songIds: readonly string[],
    tracksById: ReadonlyMap<string, MusicItem>,
): MusicItem[] {
    return uniqueBy(
        songIds.flatMap((songId) => {
            const track = tracksById.get(songId);
            return track ? [track] : [];
        }),
        (track) => track.id,
    );
}
