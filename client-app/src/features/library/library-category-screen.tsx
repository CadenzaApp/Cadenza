import type { ArtistItem, MusicItem } from "@apple-musickit";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useLayoutEffect, useState } from "react";
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
import { useAppleMusic } from "@/lib/apple-music-auth";
import { getErrorMessage } from "@/lib/error-utils";
import { collectionRoute } from "@/lib/music-routes";
import {
    useLibraryAlbums,
    useLibraryArtists,
    useTracksFromLibrary,
    useUserPlaylists,
} from "@/lib/musickit-hooks";

import { LIBRARY_CATEGORY_META, parseLibraryCategory } from "./categories";
import { TagsView } from "./tags-view";

const DEFAULT_LIBRARY_SORT: MusicListSort = {
    option: Platform.OS === "ios" ? "dateAdded" : "title",
    direction: Platform.OS === "ios" ? "descending" : "ascending",
};
const LIBRARY_SORT_OPTIONS =
    Platform.OS === "ios" ? MUSIC_LIST_SORT_OPTIONS : ([] as const);
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;

/** The five Library category bodies, hosted by either a root or tab stack. */
export function LibraryCategoryScreen({
    presentation,
}: {
    presentation: "detail" | "tab";
}) {
    const { kind } = useLocalSearchParams<{ kind: string }>();
    const category = parseLibraryCategory(kind);
    const router = useRouter();
    const navigation = useNavigation();
    const { isConnected } = useAppleMusic();
    const [librarySort, setLibrarySort] =
        useState<MusicListSort>(DEFAULT_LIBRARY_SORT);
    const title = category ? LIBRARY_CATEGORY_META[category].label : "Library";

    useLayoutEffect(() => {
        if (presentation === "tab") navigation.setOptions({ title });
    }, [navigation, presentation, title]);

    const songs = useTracksFromLibrary({
        enabled: isConnected && category === "song",
        sort: Platform.OS === "ios" ? librarySort : undefined,
    });
    const albums = useLibraryAlbums(category === "album");
    const playlists = useUserPlaylists(category === "playlist");
    const artists = useLibraryArtists(category === "artist");

    function openArtist(artist: ArtistItem) {
        if (!artist.catalogId) return;
        router.push({
            pathname: "/artist/[id]",
            params: { id: artist.catalogId, name: artist.name },
        });
    }

    function openCollection(collection: MusicItem) {
        router.push(collectionRoute(collection));
    }

    const error = category
        ? categoryError(category, songs, albums, playlists, artists)
        : undefined;
    const content = !category ? (
        <Text className="px-5 py-10 text-center text-muted-foreground">
            Unknown library section.
        </Text>
    ) : (
        <>
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
        </>
    );

    if (presentation === "detail") {
        return <DetailScreen title={title}>{content}</DetailScreen>;
    }

    return <View className="flex-1 bg-background">{content}</View>;
}

function categoryError(
    category: NonNullable<ReturnType<typeof parseLibraryCategory>>,
    songs: ReturnType<typeof useTracksFromLibrary>,
    albums: ReturnType<typeof useLibraryAlbums>,
    playlists: ReturnType<typeof useUserPlaylists>,
    artists: ReturnType<typeof useLibraryArtists>,
) {
    return category === "song"
        ? songs.tracksErr
        : category === "album"
          ? albums.albumsErr
          : category === "playlist"
            ? playlists.playlistsErr
            : category === "artist"
              ? artists.artistsErr
              : undefined;
}
