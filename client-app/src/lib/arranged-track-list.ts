import type { MusicItem } from "@apple-musickit";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
    MusicListPagination,
    MusicListSection,
    MusicListSections,
} from "@/components/custom/music-list";

import {
    indexTracksById,
    useGroupedTrackLoader,
    usePagedTracksForSongIds,
} from "./musickit-hooks";
import { groupTracks, uniqueBy } from "./paged-tracks";
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
 * a flat list that loads 50 songs at a time as it scrolls, or one header per
 * group. A grouped list loads every song once, top down in the background,
 * and keeps them, so opening or closing a group never reloads anything; the
 * group opened last goes to the front of the line. See `useArrangedSongs` for
 * the fetch and `useGroupedTrackLoader` for the groups.
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

    // a list the phone holds needs nothing looked up
    const localTracksById = useMemo(
        () => (localTracks ? indexTracksById(localTracks) : null),
        [localTracks],
    );
    const paged = usePagedTracksForSongIds(
        local || grouped ? NO_IDS : arranged.songIds,
        !local,
    );

    // which groups are open, and which was opened last. kept per grouping, so
    // a new sort, or the list fetched again, leaves them as they were. a new
    // grouping starts over with only its first group open
    const groupingKey = arrangement.group
        ? fieldKey(arrangement.group.field)
        : null;
    const [openState, setOpenState] = useState<{
        groupingKey: string | null;
        open: ReadonlySet<string>;
        lastOpened: string | null;
    }>({ groupingKey: null, open: NO_KEYS, lastOpened: null });
    const firstKey = arranged.sections?.[0]?.key ?? null;
    const current =
        openState.groupingKey === groupingKey
            ? openState
            : {
                  groupingKey,
                  open: firstKey ? new Set([firstKey]) : NO_KEYS,
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
                              open: firstKey ? new Set([firstKey]) : NO_KEYS,
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
        [firstKey, groupingKey],
    );

    // every group's songs, loaded once in group order from the one opened last
    const groupIds = useMemo(
        () =>
            arranged.sections && !local
                ? arranged.sections.map((section) => section.songIds)
                : null,
        [arranged.sections, local],
    );
    const startGroup = Math.max(
        0,
        arranged.sections?.findIndex(
            (section) => section.key === current.lastOpened,
        ) ?? 0,
    );
    const warmRowTags = useWarmRowTags();
    const afterChunk = useCallback(
        (tracks: MusicItem[]) =>
            warmRowTags(
                tracks.map((track) => track.catalogId ?? track.id),
                warmActivityTags,
            ),
        [warmActivityTags, warmRowTags],
    );
    const loader = useGroupedTrackLoader({
        groups: groupIds,
        startGroup,
        enabled: grouped && !local,
        afterChunk,
    });

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
                loader.trackFor,
                loader.isSettled,
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
    }, [
        arranged.sections,
        loader.isSettled,
        loader.trackFor,
        localTracksById,
        openKeys,
    ]);
    const listSections = useMemo<MusicListSections | null>(
        () => (sections ? { sections, onToggle } : null),
        [onToggle, sections],
    );

    // flat: the paged tracks, or a list the phone holds put in order
    const flatTracks = useMemo(() => {
        if (grouped) return NO_TRACKS;
        if (localTracksById) {
            return tracksFor(arranged.songIds, localTracksById);
        }
        return paged.tracks;
    }, [arranged.songIds, grouped, localTracksById, paged.tracks]);

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
            sections
                ? sections.flatMap((section) =>
                      section.expanded ? section.tracks : [],
                  )
                : flatTracks,
        [flatTracks, sections],
    );

    const pagination = useMemo<MusicListPagination | null>(
        () =>
            grouped || local
                ? null
                : {
                      hasNextPage: paged.hasNextPage,
                      isLoadingNextPage: paged.isLoadingNextPage,
                      onLoadNextPage: paged.loadNextPage,
                  },
        [
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
        /** The flat list's tracks. Empty when grouped. */
        tracks: flatTracks,
        shownTracks,
        /** For a list the phone holds: all its songs, arranged. */
        allLocalTracks,
        sections: listSections,
        pagination,
        /** How many ids from the top the flat list has shown. */
        loadedCount: local ? arranged.songIds.length : paged.loadedCount,
        resolveTracks: paged.resolveTracks,
        loading:
            arranged.loading ||
            (!grouped && !local && arranged.active && paged.tracksLoading),
        error:
            arranged.error ??
            (local ? undefined : (paged.tracksErr ?? loader.tracksErr)),
    };
}

const NO_IDS: string[] = [];
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
