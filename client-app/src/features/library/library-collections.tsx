import type { MusicItem } from "@apple-musickit";
import { useCallback, type ReactNode } from "react";
import { View } from "react-native";

import { CollectionList } from "@/components/custom/collection-list";
import { ErrorNotice } from "@/components/custom/error-notice";
import {
    readAllCollectionSongs,
    useLibraryAlbums,
    useLibraryCollectionSearchPages,
    useUserPlaylists,
    type LibraryCollectionKind,
} from "@/lib/musickit-hooks";
import { usePlayAll } from "@/lib/play-all";

import { LibraryListHeader, useLibraryListSearch } from "./library-list-header";
import { concatUnique, mapInOrder } from "./play-queue";

/** Collections whose songs are read at once when Play queues them. */
const COLLECTION_READS_AT_ONCE = 4;

const COPY: Record<
    LibraryCollectionKind,
    { placeholder: string; empty: string; noMatch: string }
> = {
    album: {
        placeholder: "Search Albums",
        empty: "No albums in your library yet.",
        noMatch: "No albums in your library match.",
    },
    playlist: {
        placeholder: "Search Playlists",
        empty: "No playlists in your library yet.",
        noMatch: "No playlists in your library match.",
    },
};

/**
 * The Albums or Playlists category: the library's collections, or the ones
 * matching the search field. `playable` adds Play and Shuffle, which queue
 * every song of every collection loaded so far, in list order. `above` sits
 * over the search field, scrolling with the list.
 */
export function LibraryCollections({
    kind,
    playable,
    above,
}: {
    kind: LibraryCollectionKind;
    playable: boolean;
    above?: ReactNode;
}) {
    const search = useLibraryListSearch();
    const searching = search.term !== null;
    const all = useCollections(kind);
    const results = useLibraryCollectionSearchPages(
        kind,
        search.term,
        searching,
    );
    const list = searching
        ? results
        : {
              items: all.items,
              isLoading: all.isLoading,
              isLoadingNextPage: all.isLoadingNextPage,
              hasNextPage: all.hasNextPage,
              loadNextPage: all.loadNextPage,
              error: all.error,
          };

    const shown = list.items;
    const resolveQueue = useCallback(async (): Promise<MusicItem[]> => {
        const songs = await mapInOrder(
            shown,
            COLLECTION_READS_AT_ONCE,
            (collection) =>
                readAllCollectionSongs(
                    kind,
                    collection.libraryId ?? collection.id,
                ),
        );
        return concatUnique(songs, (track) => track.id);
    }, [kind, shown]);
    const playAll = usePlayAll({ resolveQueue });

    return (
        <>
            {list.error ? <ErrorNotice error={list.error} /> : null}
            <View className="flex-1">
                <CollectionList
                    collections={shown}
                    isLoading={list.isLoading}
                    isLoadingNextPage={list.isLoadingNextPage}
                    hasNextPage={list.hasNextPage}
                    onLoadNextPage={() => void list.loadNextPage()}
                    emptyLabel={
                        searching ? COPY[kind].noMatch : COPY[kind].empty
                    }
                    header={
                        <>
                            {above ? (
                                <View className="px-5 pb-2">{above}</View>
                            ) : null}
                            <LibraryListHeader
                                search={search}
                                placeholder={COPY[kind].placeholder}
                                actions={
                                    playable
                                        ? {
                                              onPlay: playAll.play,
                                              onShuffle: playAll.shuffle,
                                              disabled: shown.length === 0,
                                              pending: playAll.pending,
                                          }
                                        : undefined
                                }
                            />
                        </>
                    }
                />
            </View>
        </>
    );
}

/** The library's albums or playlists, in one shape. Only `kind` is read. */
function useCollections(kind: LibraryCollectionKind) {
    const albums = useLibraryAlbums(kind === "album");
    const playlists = useUserPlaylists(kind === "playlist");
    return kind === "album"
        ? {
              items: albums.albums,
              isLoading: albums.albumsLoading,
              isLoadingNextPage: albums.albumsLoadingNextPage,
              hasNextPage: albums.hasNextAlbumPage,
              loadNextPage: albums.loadNextAlbumPage,
              error: albums.albumsErr,
          }
        : {
              items: playlists.playlists,
              isLoading: playlists.playlistsLoading,
              isLoadingNextPage: playlists.playlistsLoadingNextPage,
              hasNextPage: playlists.hasNextPlaylistPage,
              loadNextPage: playlists.loadNextPlaylistPage,
              error: playlists.playlistsErr,
          };
}
