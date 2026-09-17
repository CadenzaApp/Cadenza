import type { MusicItem } from "@apple-musickit";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { FlatList, Image, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { usePlaybackCommands } from "@/lib/playback";
import { useZoomSource } from "@/lib/zoom-dismiss";

const SKELETON_TILE_COUNT = 6;
const COLUMN_COUNT = 2;

type RecentlyAddedGridProps = {
    items: MusicItem[];
    isLoading: boolean;
    isLoadingNextPage: boolean;
    hasNextPage: boolean;
    onLoadNextPage: () => void;
    /** Called for an album or a playlist. Songs play instead of opening. */
    onOpenCollection: (item: MusicItem) => void;
    /** Rendered above the section title. The library index puts its rows here. */
    header?: ReactNode;
};

/**
 * The recently added feed as a two column artwork grid. Apple's feed is mixed,
 * so a tile can be an album, a playlist, or a song that was added on its own.
 * Tapping a collection opens it, tapping a song plays it.
 *
 * This owns the library screen's scroll, which is why the index's rows come in
 * as `header`: a grid this long has to page, and a paging list cannot live
 * inside a ScrollView.
 */
export function RecentlyAddedGrid({
    items,
    isLoading,
    isLoadingNextPage,
    hasNextPage,
    onLoadNextPage,
    onOpenCollection,
    header,
}: RecentlyAddedGridProps) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<MusicItem>>();
    const { togglePlayback } = usePlaybackCommands();
    const showSkeletons = isLoading && items.length === 0;

    return (
        <ScreenScrollMarker>
            <Animated.FlatList
            {...scroll}
            className="flex-1 bg-background"
            data={items}
            numColumns={COLUMN_COUNT}
            keyExtractor={(item) => `${item.resourceKind}:${item.id}`}
            renderItem={({ item }) => (
                <RecentlyAddedTile
                    item={item}
                    onPress={() => {
                        if (item.resourceKind === "song") {
                            void togglePlayback(item);
                            return;
                        }
                        onOpenCollection(item);
                    }}
                />
            )}
            columnWrapperStyle={{
                paddingHorizontal: 24,
                justifyContent: "space-between",
            }}
            contentContainerStyle={{ paddingBottom: listBottomInset }}
            ListHeaderComponent={
                <View>
                    {header}
                    <Text className="mb-4 mt-6 px-6 text-2xl font-bold tracking-tight">
                        Recently Added
                    </Text>
                </View>
            }
            ListEmptyComponent={
                showSkeletons ? (
                    <TileSkeletons />
                ) : (
                    <Text className="px-6 py-10 text-center text-muted-foreground">
                        Nothing added to your library yet.
                    </Text>
                )
            }
            ListFooterComponent={
                isLoadingNextPage ? <TileSkeletons /> : <View className="h-5" />
            }
            onEndReached={() => {
                if (hasNextPage && !isLoadingNextPage) onLoadNextPage();
            }}
            onEndReachedThreshold={0.3}
            showsVerticalScrollIndicator={false}
        />
        </ScreenScrollMarker>
    );
}

function TileSkeletons() {
    return (
        <View className="flex-row flex-wrap justify-between gap-y-5 px-6">
            {Array.from({ length: SKELETON_TILE_COUNT }, (_, index) => (
                <View key={index} className="w-[48%]">
                    <Skeleton className="aspect-square w-full rounded-lg" />
                    <Skeleton className="mt-2 h-4 w-3/4 rounded" />
                    <Skeleton className="mt-1 h-3 w-1/2 rounded" />
                </View>
            ))}
        </View>
    );
}

function RecentlyAddedTile({
    item,
    onPress,
}: {
    item: MusicItem;
    onPress: () => void;
}) {
    const { colors } = useTheme();
    const { ref: zoomRef, capture: captureZoom } = useZoomSource();
    const artworkUrl = item.artworkUrlLarge?.trim() ?? item.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);
    // Playlists carry a curator in artistName and often carry no one at all.
    const subtitle = item.artistName ?? KIND_LABEL[item.resourceKind];

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                item.resourceKind === "song"
                    ? `Play ${item.title}`
                    : `Open ${item.title}`
            }
            onPress={() => {
                // What the collection screen minimizes back into.
                captureZoom();
                onPress();
            }}
            className="mb-5 w-[48%] active:opacity-80"
        >
            <View
                ref={zoomRef}
                collapsable={false}
                className="aspect-square w-full"
            >
                {canRenderArtwork ? (
                    <Image
                        source={{ uri: artworkUrl }}
                        className="h-full w-full rounded-lg bg-muted"
                    />
                ) : (
                    <View className="h-full w-full items-center justify-center rounded-lg bg-muted">
                        <Ionicons
                            name={KIND_ICON[item.resourceKind]}
                            size={28}
                            color={colors.text}
                        />
                    </View>
                )}
            </View>
            <Text
                className="mt-2 font-semibold leading-tight"
                numberOfLines={1}
            >
                {item.title}
            </Text>
            <Text
                className="mt-0.5 text-sm leading-tight text-muted-foreground"
                numberOfLines={1}
            >
                {subtitle}
            </Text>
        </Pressable>
    );
}

const KIND_LABEL = {
    song: "Song",
    album: "Album",
    playlist: "Playlist",
} as const;

const KIND_ICON = {
    song: "musical-notes",
    album: "disc",
    playlist: "list",
} as const;
