import type { LibrarySongSort, MusicItem } from "@apple-musickit";
import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";

import { ModalPopup } from "@/components/custom/modal-popup";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { SettingHelpRow } from "@/components/ui/setting-help-row";
import { GlassToggle } from "@/components/ui/glass-toggle";
import { useRailActions } from "@/lib/use-rail-actions";
import { ErrorNotice } from "@/components/custom/error-notice";
import { MusicList } from "@/components/custom/music-list";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useArrangedTrackList } from "@/lib/arranged-track-list";
import {
    readAllLibrarySongs,
    useAllTracksFromLibrary,
    useLibrarySongSearchPages,
    usePagedTracksForSongIds,
    useTrackLookup,
    useTracksFromLibrary,
} from "@/lib/musickit-hooks";
import { trackIdentityKeys, uniqueBy } from "@/lib/paged-tracks";
import { useQueryResults } from "@/lib/routes/queries";
import { usePlayAll } from "@/lib/play-all";
import {
    isArranged,
    NO_ARRANGEMENT,
    type SongArrangement,
} from "@/lib/song-arrangement";

import { useLibrarySongPreferences } from "./library-song-preferences";
import { librarySongSource } from "./library-song-source";
import { LibraryListHeader, useLibraryListSearch } from "./library-list-header";

/**
 * Apple's order, for Sort by None: newest additions first where MusicKit can
 * sort (iOS), and Apple's own order elsewhere.
 */
const APPLE_LIBRARY_ORDER: LibrarySongSort | undefined =
    Platform.OS === "ios"
        ? { option: "dateAdded", direction: "descending" }
        : undefined;
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

/**
 * The Songs category. Three lists behind one header: Apple's paged library,
 * the backend's sorted or grouped copy of it, and library search results while
 * the field holds a term. Sort by and Group by step aside during a search,
 * since Apple ranks those results itself.
 */
export function LibrarySongs() {
    const { isConnected } = useAppleMusic();
    const { showAllTagged, ready, saving, saveError, setShowAllTagged } =
        useLibrarySongPreferences();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingHelpOpen, setSettingHelpOpen] = useState(false);
    const closeSettings = useCallback(() => {
        setSettingHelpOpen(false);
        setSettingsOpen(false);
    }, []);
    const railActions = useMemo(
        () => [
            {
                icon: "settings-outline" as const,
                accessibilityLabel: "Songs settings",
                onPress: () => setSettingsOpen(true),
            },
        ],
        [],
    );
    useRailActions(railActions);
    const search = useLibraryListSearch();
    const searching = search.term !== null;
    // starts unsorted every time the screen opens, and is never saved
    const [arrangement, setArrangement] =
        useState<SongArrangement>(NO_ARRANGEMENT);
    const arranged = isArranged(arrangement);

    const songs = useTracksFromLibrary({
        enabled:
            ready && isConnected && !showAllTagged && !arranged && !searching,
        sort: APPLE_LIBRARY_ORDER,
    });
    const results = useLibrarySongSearchPages(
        search.term,
        ready && searching && !showAllTagged,
    );
    const librarySource = useMemo(
        () =>
            ready
                ? librarySongSource(showAllTagged, arranged, search.term)
                : null,
        [ready, showAllTagged, arranged, search.term],
    );
    const usingBackend = showAllTagged || (!searching && arranged);
    const widened = showAllTagged && (searching || !arranged);
    // The unarranged list follows library-sync and tag invalidations. Sorted
    // lists keep their snapshot so edits never reorder rows under a finger.
    const widenedQuery = useQueryResults(
        widened && librarySource?.kind === "query" ? librarySource.query : null,
        false,
        "libraryOrTagged",
    );
    const widenedSongs = usePagedTracksForSongIds(
        widenedQuery.matchedSongIds,
        ready && widened,
    );
    const { tracks: widenedTracks, resolveTracks: resolveWidenedTracks } =
        widenedSongs;
    const { libraryTracksById: libraryById } = useAllTracksFromLibrary(
        ready && showAllTagged,
    );
    const identity = useCallback(
        (track: MusicItem) =>
            trackIdentityKeys(libraryById.get(track.id) ?? track),
        [libraryById],
    );
    const lookupTracks = useTrackLookup(
        librarySource !== null && arranged && !searching,
    );
    const resetArrangement = useCallback(
        () => setArrangement(NO_ARRANGEMENT),
        [setArrangement],
    );
    const arrangedSongs = useArrangedTrackList({
        source: arranged && !searching ? librarySource : null,
        arrangement: searching ? NO_ARRANGEMENT : arrangement,
        lookupTracks,
        onRejected: resetArrangement,
    });

    // what Play and Shuffle queue: the search results loaded so far, what a
    // sorted list shows, or else the whole library in Apple's order
    const resolveQueue = useCallback(async (): Promise<MusicItem[]> => {
        if (searching && !showAllTagged) return results.items;
        if (widened)
            return searching
                ? widenedTracks
                : resolveWidenedTracks(widenedQuery.matchedSongIds);
        if (usingBackend) return uniqueBy(arrangedSongs.shownTracks, identity);
        return readAllLibrarySongs(APPLE_LIBRARY_ORDER);
    }, [
        arrangedSongs.shownTracks,
        identity,
        results.items,
        searching,
        showAllTagged,
        usingBackend,
        widened,
        widenedTracks,
        resolveWidenedTracks,
        widenedQuery.matchedSongIds,
    ]);
    const playAll = usePlayAll({ resolveQueue });

    const list =
        searching && !showAllTagged
            ? {
                  tracks: results.items,
                  isLoading: results.isLoading,
                  error: results.error,
                  pagination: {
                      hasNextPage: results.hasNextPage,
                      isLoadingNextPage: results.isLoadingNextPage,
                      onLoadNextPage: results.loadNextPage,
                  },
                  sections: null,
              }
            : widened
              ? {
                    tracks: widenedSongs.tracks,
                    isLoading:
                        widenedQuery.queryResultsLoading ||
                        widenedSongs.tracksLoading,
                    error:
                        widenedQuery.queryResultsErr ?? widenedSongs.tracksErr,
                    pagination: {
                        hasNextPage: widenedSongs.hasNextPage,
                        isLoadingNextPage: widenedSongs.isLoadingNextPage,
                        onLoadNextPage: widenedSongs.loadNextPage,
                    },
                    sections: null,
                }
              : usingBackend
                ? {
                      tracks: arrangedSongs.tracks,
                      isLoading: arrangedSongs.loading,
                      error: arrangedSongs.error,
                      pagination: arrangedSongs.pagination,
                      sections: arrangedSongs.sections,
                  }
                : {
                      tracks: songs.tracks,
                      isLoading: songs.tracksLoading,
                      error: songs.tracksErr,
                      pagination: {
                          hasNextPage: songs.hasNextLibraryPage,
                          isLoadingNextPage: songs.tracksLoadingNextPage,
                          onLoadNextPage: songs.loadNextLibraryPage,
                      },
                      sections: null,
                  };
    const visibleTracks = useMemo(
        () => uniqueBy(list.tracks, identity),
        [list.tracks, identity],
    );
    const visibleSections = useMemo(() => {
        if (!list.sections) return null;
        const seen = new Set<string>();
        return {
            ...list.sections,
            sections: list.sections.sections.map((section) => {
                const tracks = uniqueBy(section.tracks, identity, seen);
                return {
                    ...section,
                    tracks,
                    count:
                        section.count - (section.tracks.length - tracks.length),
                };
            }),
        };
    }, [list.sections, identity]);
    const hasSongs = visibleTracks.length > 0 || visibleSections !== null;

    return (
        <>
            {list.error ? <ErrorNotice error={list.error} /> : null}
            <View className="flex-1">
                <MusicList
                    tracks={visibleTracks}
                    isLoading={!ready || list.isLoading}
                    pagination={list.pagination}
                    sections={visibleSections}
                    arrangement={
                        searching
                            ? null
                            : {
                                  value: arrangement,
                                  onChange: setArrangement,
                                  sortValues: usingBackend
                                      ? arrangedSongs.sortValues
                                      : undefined,
                              }
                    }
                    header={
                        <LibraryListHeader
                            search={search}
                            placeholder="Search Songs"
                            actions={{
                                onPlay: playAll.play,
                                onShuffle: playAll.shuffle,
                                disabled: !hasSongs,
                                pending: playAll.pending,
                            }}
                        />
                    }
                    emptyContent={
                        <Text className="mt-10 text-center text-muted-foreground">
                            {searching
                                ? "No songs in your library match."
                                : "No songs in your library yet."}
                        </Text>
                    }
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    fullBleedRows
                />
            </View>
            <ModalPopup
                visible={settingsOpen}
                onClose={closeSettings}
                title="Songs settings"
                titleClassName="pr-10"
                contentStyle={{ width: "90%", maxWidth: 460 }}
            >
                <DialogCloseButton
                    onPress={closeSettings}
                    accessibilityLabel="Close songs settings"
                />
                <SettingHelpRow
                    label="Include all with tags"
                    help="Include songs you have tagged outside your Apple Music library. Turn this off to show only songs added to Apple Music."
                    helpOpen={settingHelpOpen}
                    reserveHelpSpace
                    onHelpPress={() => setSettingHelpOpen((open) => !open)}
                >
                    <GlassToggle
                        value={showAllTagged}
                        disabled={saving || !ready}
                        accessibilityLabel="Include all with tags"
                        onValueChange={async (value) => {
                            try {
                                await setShowAllTagged(value);
                            } catch {
                                /* The hook restores the previous value and exposes saveError. */
                            }
                        }}
                    />
                </SettingHelpRow>
                {saveError ? (
                    <Text className="text-sm text-destructive">
                        {"Couldn't save this setting. Try again."}
                    </Text>
                ) : null}
            </ModalPopup>
        </>
    );
}
