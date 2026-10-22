import type { ArtistItem, LibrarySongSort, MusicItem } from "@apple-musickit";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useCallback, useLayoutEffect, useMemo } from "react";
import { Platform, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { ArtistList } from "@/components/custom/artist-list";
import { CollectionList } from "@/components/custom/collection-list";
import { MusicList } from "@/components/custom/music-list";
import { DetailScreen } from "@/components/ui/detail-screen";
import { Text } from "@/components/ui/text";
import { useAppleMusic } from "@/lib/apple-music-auth";
import { useArrangedTrackList } from "@/lib/arranged-track-list";
import { collectionRoute } from "@/lib/music-routes";
import {
    useLibraryAlbums,
    useLibraryArtists,
    useTrackLookup,
    useTracksFromLibrary,
    useUserPlaylists,
} from "@/lib/musickit-hooks";
import { useOpenScreen } from "@/lib/open-screen";
import type { QueryJSON } from "@/lib/query-json";
import type { ArrangeSource } from "@/lib/routes/arrange";
import { useSavedArrangement } from "@/lib/saved-arrangement";
import { isArranged, NO_ARRANGEMENT } from "@/lib/song-arrangement";

import { LIBRARY_CATEGORY_META, parseLibraryCategory } from "./categories";
import { TagsView } from "./tags-view";

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

/** The five Library category bodies, hosted by either a root or tab stack. */
export function LibraryCategoryScreen({
    presentation,
}: {
    presentation: "detail" | "tab";
}) {
    const { kind } = useLocalSearchParams<{ kind: string }>();
    const category = parseLibraryCategory(kind);
    const openScreen = useOpenScreen();
    const navigation = useNavigation();

    const { isConnected } = useAppleMusic();
    const { arrangement, setArrangement, ready } =
        useSavedArrangement("library");
    const arranged = isArranged(arrangement);
    const title = category ? LIBRARY_CATEGORY_META[category].label : "Library";

    useLayoutEffect(() => {
        if (presentation === "tab") navigation.setOptions({ title });
    }, [navigation, presentation, title]);

    const songs = useTracksFromLibrary({
        enabled: isConnected && category === "song" && ready && !arranged,
        sort: APPLE_LIBRARY_ORDER,
    });
    const librarySource = useMemo<ArrangeSource | null>(
        () =>
            category === "song" && arranged
                ? {
                      kind: "query",
                      query: WHOLE_LIBRARY,
                      considerDefaultTags: false,
                      libraryOnly: true,
                  }
                : null,
        [arranged, category],
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
    const albums = useLibraryAlbums(category === "album");
    const playlists = useUserPlaylists(category === "playlist");
    const artists = useLibraryArtists(category === "artist");

    function openArtist(artist: ArtistItem) {
        if (!artist.catalogId) return;
        openScreen({
            pathname: "/artist/[id]",
            params: { id: artist.catalogId, name: artist.name },
        });
    }

    function openCollection(collection: MusicItem) {
        openScreen(collectionRoute(collection));
    }

    const error = category
        ? categoryError(
              category,
              arranged ? arrangedSongs.error : songs.tracksErr,
              albums,
              playlists,
              artists,
          )
        : undefined;
    const content = !category ? (
        <Text className="px-5 py-10 text-center text-muted-foreground">
            Unknown library section.
        </Text>
    ) : (
        <>
            {error ? <ErrorNotice error={error} /> : null}

            <View className="flex-1">
                {category === "tag" ? (
                    <TagsView />
                ) : category === "song" ? (
                    <MusicList
                        tracks={arranged ? arrangedSongs.tracks : songs.tracks}
                        isLoading={
                            !ready ||
                            (arranged
                                ? arrangedSongs.loading
                                : songs.tracksLoading)
                        }
                        pagination={
                            arranged
                                ? arrangedSongs.pagination
                                : {
                                      hasNextPage: songs.hasNextLibraryPage,
                                      isLoadingNextPage:
                                          songs.tracksLoadingNextPage,
                                      onLoadNextPage: songs.loadNextLibraryPage,
                                  }
                        }
                        sections={arranged ? arrangedSongs.sections : null}
                        arrangement={{
                            value: arrangement,
                            onChange: setArrangement,
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
                        prefetchSongs
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
                        prefetchSongs
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
    songsErr: unknown,
    albums: ReturnType<typeof useLibraryAlbums>,
    playlists: ReturnType<typeof useUserPlaylists>,
    artists: ReturnType<typeof useLibraryArtists>,
) {
    return category === "song"
        ? songsErr
        : category === "album"
          ? albums.albumsErr
          : category === "playlist"
            ? playlists.playlistsErr
            : category === "artist"
              ? artists.artistsErr
              : undefined;
}
