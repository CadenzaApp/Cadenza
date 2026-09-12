import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { Image, Pressable, ScrollView, View } from "react-native";

import { MusicList } from "@/components/custom/music-list";
import { SheetScreen } from "@/components/ui/sheet-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { getErrorMessage } from "@/lib/error-utils";
import { useArtist } from "@/lib/musickit-hooks";

const ALBUM_TILE_WIDTH = 132;
const ALBUM_PLACEHOLDER_COUNT = 4;
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
const NO_PAGINATION = {
    hasNextPage: false,
    isLoadingNextPage: false,
    onLoadNextPage: () => undefined,
} as const;

/**
 * One catalog artist: their albums as a rail, then their top songs.
 *
 * The albums rail scrolls sideways on purpose. `MusicList` owns a `FlatList`,
 * so stacking both vertically would nest two scroll views and neither would
 * behave. Catalog only: a library song with no catalog equivalent has no
 * artist ID to arrive here with, and the menu row that leads here is disabled
 * for it.
 */
export default function ArtistScreen() {
    const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
    const router = useRouter();
    const { artist, artistLoading, artistErr } = useArtist(id);
    const albums = artist?.albums ?? [];

    function openAlbum(album: MusicItem) {
        router.push({
            pathname: "/collection/[kind]/[id]",
            params: { kind: "album", id: album.id, title: album.title },
        });
    }

    return (
        <SheetScreen title={artist?.name ?? name ?? "Artist"}>
            {artistErr ? (
                <Text className="my-2 px-6 text-center text-destructive">
                    {getErrorMessage(artistErr)}
                </Text>
            ) : null}

            {artistLoading || albums.length > 0 ? (
                <View>
                    <Text className="px-6 pb-3 text-xl font-bold text-foreground">
                        Albums
                    </Text>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{
                            paddingHorizontal: 24,
                            gap: 12,
                        }}
                    >
                        {artistLoading && albums.length === 0
                            ? Array.from(
                                  { length: ALBUM_PLACEHOLDER_COUNT },
                                  (_, index) => (
                                      <View
                                          key={index}
                                          style={{ width: ALBUM_TILE_WIDTH }}
                                      >
                                          <Skeleton className="aspect-square w-full rounded-lg" />
                                          <Skeleton className="mt-2 h-4 w-3/4 rounded" />
                                      </View>
                                  ),
                              )
                            : albums.map((album) => (
                                  <AlbumTile
                                      key={album.id}
                                      album={album}
                                      onPress={() => openAlbum(album)}
                                  />
                              ))}
                    </ScrollView>
                </View>
            ) : null}

            <Text className="px-6 pb-1 pt-5 text-xl font-bold text-foreground">
                Top Songs
            </Text>
            <View className="flex-1">
                <MusicList
                    tracks={artist?.topSongs ?? []}
                    isLoading={artistLoading}
                    pagination={NO_PAGINATION}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    fullBleedRows
                />
            </View>
        </SheetScreen>
    );
}

function AlbumTile({
    album,
    onPress,
}: {
    album: MusicItem;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    const artworkUrl = album.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${album.title}`}
            onPress={onPress}
            style={{ width: ALBUM_TILE_WIDTH }}
            className="active:opacity-80"
        >
            {canRenderArtwork ? (
                <Image
                    source={{ uri: artworkUrl }}
                    className="aspect-square w-full rounded-lg bg-muted"
                />
            ) : (
                <View className="aspect-square w-full items-center justify-center rounded-lg bg-muted">
                    <Ionicons name="disc" size={28} color={colors.text} />
                </View>
            )}
            <Text
                className="mt-2 text-sm font-semibold text-foreground"
                numberOfLines={2}
            >
                {album.title}
            </Text>
        </Pressable>
    );
}
