import type { LibrarySongSort, MusicItem } from "@apple-musickit";
import { useCallback, useMemo, useState } from "react";
import { Platform, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { MusicList } from "@/components/custom/music-list";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useArrangedTrackList } from "@/lib/arranged-track-list";
import {
    readAllLibrarySongs,
    useLibrarySongSearchPages,
    useTrackLookup,
    useTracksFromLibrary,
} from "@/lib/musickit-hooks";
import { usePlayAll } from "@/lib/play-all";
import type { QueryJSON } from "@/lib/query-json";
import type { ArrangeSource } from "@/lib/routes/arrange";
import {
    isArranged,
    NO_ARRANGEMENT,
    type SongArrangement,
} from "@/lib/song-arrangement";

import { LibraryListHeader, useLibraryListSearch } from "./library-list-header";

/**
 * Apple's order, for Sort by None: newest additions first where MusicKit can
 * sort (iOS), and Apple's own order elsewhere.
 */
const APPLE_LIBRARY_ORDER: LibrarySongSort | undefined =
    Platform.OS === "ios"
        ? { option: "dateAdded", direction: "descending" }
        : undefined;
/**
 * Every song in the library, as a query. Sorted or grouped, the library is
 * this query run library-only, so the backend sorts all of it at once from its
 * own copy of the library and of each song's metadata.
 */
const WHOLE_LIBRARY: QueryJSON = { where: { and: [] } };
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

/**
 * The Songs category. Three lists behind one header: Apple's paged library,
 * the backend's sorted or grouped copy of it, and library search results while
 * the field holds a term. Sort by and Group by step aside during a search,
 * since Apple ranks those results itself.
 */
export function LibrarySongs() {
    const { isConnected } = useAppleMusic();
    const search = useLibraryListSearch();
    const searching = search.term !== null;
    // starts unsorted every time the screen opens, and is never saved
    const [arrangement, setArrangement] =
        useState<SongArrangement>(NO_ARRANGEMENT);
    const arranged = isArranged(arrangement);

    const songs = useTracksFromLibrary({
        enabled: isConnected && !arranged,
        sort: APPLE_LIBRARY_ORDER,
    });
    const results = useLibrarySongSearchPages(search.term, searching);
    const librarySource = useMemo<ArrangeSource | null>(
        () =>
            arranged
                ? {
                      kind: "query",
                      query: WHOLE_LIBRARY,
                      considerDefaultTags: false,
                      scope: "library",
                  }
                : null,
        [arranged],
    );
    // the whole library read is only worth starting for a sorted list
    const lookupTracks = useTrackLookup(librarySource !== null);
    const resetArrangement = useCallback(
        () => setArrangement(NO_ARRANGEMENT),
        [setArrangement],
    );
    const arrangedSongs = useArrangedTrackList({
        source: librarySource,
        arrangement,
        lookupTracks,
        onRejected: resetArrangement,
    });

    // what Play and Shuffle queue: the search results loaded so far, what a
    // sorted list shows, or else the whole library in Apple's order
    const resolveQueue = useCallback(async (): Promise<MusicItem[]> => {
        if (searching) return results.items;
        if (arranged) return arrangedSongs.shownTracks;
        return readAllLibrarySongs(APPLE_LIBRARY_ORDER);
    }, [arranged, arrangedSongs.shownTracks, results.items, searching]);
    const playAll = usePlayAll({ resolveQueue });

    const list = searching
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
        : arranged
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
    const hasSongs = list.tracks.length > 0 || list.sections !== null;

    return (
        <>
            {list.error ? <ErrorNotice error={list.error} /> : null}
            <View className="flex-1">
                <MusicList
                    tracks={list.tracks}
                    isLoading={list.isLoading}
                    pagination={list.pagination}
                    sections={list.sections}
                    arrangement={
                        searching
                            ? null
                            : {
                                  value: arrangement,
                                  onChange: setArrangement,
                                  sortValues: arranged
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
        </>
    );
}
