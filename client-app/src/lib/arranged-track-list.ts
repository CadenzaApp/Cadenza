import type { MusicItem } from "@apple-musickit";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
    MusicListPagination,
    MusicListSection,
    MusicListSections,
} from "@/components/custom/music-list";

import {
    indexTracksById,
    SECTION_PAGE_SIZE,
    usePagedTracksForSongIds,
    useSectionedTracks,
    type SongIdSection,
} from "./musickit-hooks";
import { uniqueBy } from "./paged-tracks";
import {
    useArrangedSongs,
    type ArrangeSource,
    type TrackLookup,
} from "./routes/arrange";
import { isArranged, type SongArrangement } from "./song-arrangement";

const NO_TRACKS: MusicItem[] = [];
const NO_SECTION_REQUESTS: SongIdSection[] = [];

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
};

/**
 * A song list the backend sorts and groups, made into what `MusicList` draws:
 * a flat list that loads 50 songs at a time as it scrolls, or one header per
 * group that loads its songs when it opens. See `useArrangedSongs` for the
 * fetch and `useSectionedTracks` for the groups.
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

    // which groups are open, and how many songs each shows. belongs to one
    // set of groups, so a new arrangement starts over with only the first open
    const [open, setOpen] = useState<{
        sections: typeof arranged.sections;
        shown: ReadonlyMap<string, number>;
    }>({ sections: null, shown: new Map() });
    const firstOpen = useMemo(
        () => firstSectionOpen(arranged.sections),
        [arranged.sections],
    );
    const shown = open.sections === arranged.sections ? open.shown : firstOpen;
    const updateShown = useCallback(
        (update: (shown: Map<string, number>) => void) => {
            setOpen((current) => {
                const next = new Map(
                    current.sections === arranged.sections
                        ? current.shown
                        : firstSectionOpen(arranged.sections),
                );
                update(next);
                return { sections: arranged.sections, shown: next };
            });
        },
        [arranged.sections],
    );

    const sectionRequests = useMemo<SongIdSection[]>(
        () =>
            arranged.sections && !local
                ? arranged.sections.map((section) => ({
                      key: section.key,
                      songIds: section.songIds,
                      requestedCount: shown.get(section.key) ?? 0,
                  }))
                : NO_SECTION_REQUESTS,
        [arranged.sections, local, shown],
    );
    const sectioned = useSectionedTracks(sectionRequests, !local && grouped);

    const sections = useMemo<MusicListSection[] | null>(() => {
        if (!arranged.sections) return null;
        return arranged.sections.map((section) => {
            const requested = shown.get(section.key) ?? 0;
            const expanded = requested > 0;
            if (localTracksById) {
                const tracks = expanded
                    ? tracksFor(
                          section.songIds.slice(0, requested),
                          localTracksById,
                      )
                    : NO_TRACKS;
                return {
                    key: section.key,
                    label: section.label,
                    count: section.count,
                    expanded,
                    tracks,
                    isLoading: false,
                    hasMore: expanded && requested < section.songIds.length,
                };
            }
            const resolved = sectioned.tracksBySection.get(section.key);
            const tracks = expanded
                ? (resolved?.tracks ?? NO_TRACKS)
                : NO_TRACKS;
            const consumed = resolved?.consumedCount ?? 0;
            return {
                key: section.key,
                label: section.label,
                count: section.count,
                expanded,
                tracks,
                isLoading:
                    expanded &&
                    sectioned.pending &&
                    consumed < Math.min(requested, section.songIds.length),
                hasMore: expanded && requested < section.songIds.length,
            };
        });
    }, [
        arranged.sections,
        localTracksById,
        sectioned.pending,
        sectioned.tracksBySection,
        shown,
    ]);

    const onToggle = useCallback(
        (key: string) =>
            updateShown((next) => {
                if ((next.get(key) ?? 0) > 0) next.delete(key);
                else next.set(key, SECTION_PAGE_SIZE);
            }),
        [updateShown],
    );
    const onShowMore = useCallback(
        (key: string) =>
            updateShown((next) =>
                next.set(key, (next.get(key) ?? 0) + SECTION_PAGE_SIZE),
            ),
        [updateShown],
    );
    const listSections = useMemo<MusicListSections | null>(
        () => (sections ? { sections, onToggle, onShowMore } : null),
        [onShowMore, onToggle, sections],
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
            (local ? undefined : (paged.tracksErr ?? sectioned.tracksErr)),
    };
}

const NO_IDS: string[] = [];
const NO_SHOWN: ReadonlyMap<string, number> = new Map();

/** A grouped list opens with its first group open, so there is something to see. */
function firstSectionOpen(
    sections: readonly { key: string }[] | null,
): ReadonlyMap<string, number> {
    const first = sections?.[0];
    return first ? new Map([[first.key, SECTION_PAGE_SIZE]]) : NO_SHOWN;
}

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
