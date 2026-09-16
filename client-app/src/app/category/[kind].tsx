import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Platform, View } from "react-native";

import { ArtistList } from "@/components/custom/artist-list";
import { CollectionList } from "@/components/custom/collection-list";
import {
    MusicList,
    MUSIC_LIST_SORT_OPTIONS,
    type MusicListSort,
} from "@/components/custom/music-list";
import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";
import {
    LIBRARY_CATEGORY_META,
    parseLibraryCategory,
} from "@/features/library/categories";
import { TagsView } from "@/features/library/tags-view";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import { collectionRoute } from "@/lib/music-routes";
import {
    useLibraryAlbums,
    useLibraryArtists,
    useTracksFromLibrary,
    useUserPlaylists,
} from "@/lib/musickit-hooks";
import type { ArtistItem, MusicItem } from "@apple-musickit";

const DEFAULT_LIBRARY_SORT: MusicListSort = {
    option: Platform.OS === "ios" ? "dateAdded" : "title",
    direction: Platform.OS === "ios" ? "descending" : "ascending",
};
const LIBRARY_SORT_OPTIONS =
    Platform.OS === "ios" ? MUSIC_LIST_SORT_OPTIONS : ([] as const);
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

/**
 * One library category, opened from the library screen. Songs, albums,
 * playlists, and tags all present the same way: a sheet titled with the
 * category, holding that category's list.
 */
export default function LibraryCategoryScreen() {
    const { kind } = useLocalSearchParams<{ kind: string }>();
    const category = parseLibraryCategory(kind);
    const router = useRouter();
    const { isConnected } = useAppleMusic();
    const [librarySort, setLibrarySort] =
        useState<MusicListSort>(DEFAULT_LIBRARY_SORT);

    const songs = useTracksFromLibrary({
        enabled: isConnected && category === "song",
        sort: Platform.OS === "ios" ? librarySort : undefined,
    });
    const albums = useLibraryAlbums(category === "album");
    const playlists = useUserPlaylists(category === "playlist");
    const artists = useLibraryArtists(category === "artist");

    function openArtist(artist: ArtistItem) {
        // Catalog only; ArtistList already disables a row without a catalog id.
        if (!artist.catalogId) return;
        router.push({
            pathname: "/artist/[id]",
            params: { id: artist.catalogId, name: artist.name },
        });
    }

    function openCollection(collection: MusicItem) {
        router.push(collectionRoute(collection));
    }

    if (!category) {
        return (
            <DetailScreen title="Library">
                <Text className="px-5 py-10 text-center text-muted-foreground">
                    Unknown library section.
                </Text>
            </DetailScreen>
        );
    }

    const error =
        category === "song"
            ? songs.tracksErr
            : category === "album"
              ? albums.albumsErr
              : category === "playlist"
                ? playlists.playlistsErr
                : category === "artist"
                  ? artists.artistsErr
                  : undefined;

    return (
        <DetailScreen title={LIBRARY_CATEGORY_META[category].label}>
            {error ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(error)}
                </Text>
            ) : null}

            <View className="flex-1">
                {category === "tag" ? (
                    <TagsView />
                ) : category === "song" ? (
                    <MusicList
                        tracks={songs.tracks}
                        isLoading={songs.tracksLoading}
                        pagination={{
                            hasNextPage: songs.hasNextLibraryPage,
                            isLoadingNextPage: songs.tracksLoadingNextPage,
                            onLoadNextPage: songs.loadNextLibraryPage,
                        }}
                        sorting={{
                            options: LIBRARY_SORT_OPTIONS,
                            value: librarySort,
                            strategy: "remote",
                            onChange: setLibrarySort,
                        }}
                        multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                        fullBleedRows
                    />
                ) : category === "artist" ? (
                    <ArtistList
                        artists={artists.artists}
                        isLoading={artists.artistsLoading}
                        isLoadingNextPage={artists.artistsLoadingNextPage}
                        hasNextPage={artists.hasNextArtistsPage}
                        onLoadNextPage={artists.loadNextArtistsPage}
                        onSelect={openArtist}
                        emptyLabel="No artists in your library yet."
                    />
                ) : category === "album" ? (
                    <CollectionList
                        collections={albums.albums}
                        isLoading={albums.albumsLoading}
                        isLoadingNextPage={albums.albumsLoadingNextPage}
                        hasNextPage={albums.hasNextAlbumPage}
                        onLoadNextPage={albums.loadNextAlbumPage}
                        onSelect={openCollection}
                        emptyLabel="No albums in your library yet."
                    />
                ) : (
                    <CollectionList
                        collections={playlists.playlists}
                        isLoading={playlists.playlistsLoading}
                        isLoadingNextPage={playlists.playlistsLoadingNextPage}
                        hasNextPage={playlists.hasNextPlaylistPage}
                        onLoadNextPage={playlists.loadNextPlaylistPage}
                        onSelect={openCollection}
                        emptyLabel="No playlists in your library yet."
                    />
                )}
            </View>
        </DetailScreen>
    );
}
