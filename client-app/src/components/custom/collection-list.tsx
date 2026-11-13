import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import type { ReactNode } from "react";
import { FlatList, View } from "react-native";
import Animated from "react-native-reanimated";
import { usePrefetchCollectionSongs } from "@/lib/musickit-hooks";

import { MusicListItemSkeleton } from "@/components/custom/music-list/music-list-item";
import { ZoomTile } from "@/components/custom/zoom-tile";
import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { useVisibleItems } from "@/lib/use-visible-items";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { collectionRoute } from "@/lib/music-routes";

const SKELETON_ROW_COUNT = 8;

type CollectionListProps = {
    collections: MusicItem[];
    isLoading: boolean;
    isLoadingNextPage: boolean;
    hasNextPage: boolean;
    onLoadNextPage: () => void;
    /**
     * Picks a collection for something, like the playlist picker. Without it
     * a tap opens the collection, and its songs start loading as the finger
     * lands.
     */
    onSelect?: (collection: MusicItem) => void;
    /** Shown when the list is loaded and empty. */
    emptyLabel: string;
    /** Scrolls with the rows, above the first one. */
    header?: ReactNode;
};

/**
 * A paged list of albums or playlists. Deliberately much simpler than
 * `MusicList`: sorting, multi-select, tagging, and the track menu all describe
 * songs, and none of them mean anything for a collection. Tapping a row opens
 * the collection rather than playing it, unless `onSelect` picks it instead.
 */
export function CollectionList({
    collections: givenCollections,
    isLoading,
    isLoadingNextPage,
    hasNextPage,
    onLoadNextPage,
    onSelect,
    emptyLabel,
    header,
}: CollectionListProps) {
    const collections = useVisibleItems(givenCollections);
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<MusicItem>>();

    return (
        <ScreenScrollMarker>
            <Animated.FlatList
                {...scroll}
                className="flex-1"
                data={collections}
                keyExtractor={(collection) => collection.id}
                renderItem={({ item }) => (
                    <CollectionListItem collection={item} onSelect={onSelect} />
                )}
                contentContainerStyle={[
                    { paddingBottom: listBottomInset },
                    scroll.contentContainerStyle,
                ]}
                ListHeaderComponent={header ? <>{header}</> : null}
                // in the list rather than in place of it, so the header and
                // its search field stay mounted while a new page loads
                ListEmptyComponent={
                    isLoading ? (
                        <View>
                            {Array.from(
                                { length: SKELETON_ROW_COUNT },
                                (_, index) => (
                                    <MusicListItemSkeleton
                                        key={index}
                                        fullBleed
                                    />
                                ),
                            )}
                        </View>
                    ) : (
                        <Text className="px-6 py-10 text-center text-muted-foreground">
                            {emptyLabel}
                        </Text>
                    )
                }
                keyboardDismissMode="on-drag"
                keyboardShouldPersistTaps="handled"
                ListFooterComponent={
                    isLoadingNextPage ? (
                        <MusicListItemSkeleton fullBleed />
                    ) : null
                }
                onEndReached={() => {
                    if (hasNextPage && !isLoadingNextPage) onLoadNextPage();
                }}
                onEndReachedThreshold={0.1}
                showsVerticalScrollIndicator={false}
            />
        </ScreenScrollMarker>
    );
}

function CollectionListItem({
    collection,
    onSelect,
}: {
    collection: MusicItem;
    onSelect?: (collection: MusicItem) => void;
}) {
    const { colors } = useTheme();
    const prefetch = usePrefetchCollectionSongs();
    // Playlists carry a curator in artistName and often no one at all.
    const subtitle =
        collection.artistName ??
        (collection.resourceKind === "playlist" ? "Playlist" : "Album");

    return (
        <ZoomTile
            href={onSelect ? null : collectionRoute(collection)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${collection.title}`}
            // the songs start loading as the finger lands, not after the open
            onPressIn={() => {
                if (!onSelect) prefetch(collection);
            }}
            onPress={() => onSelect?.(collection)}
            className="relative flex-row items-center px-6 py-3 active:opacity-80"
            artwork={
                <View collapsable={false} className="mr-3 h-14 w-14 shrink-0">
                    <RemoteArtwork
                        url={collection.artworkUrl}
                        className="h-full w-full rounded"
                        fallback={
                            <Ionicons
                                name={
                                    collection.resourceKind === "playlist"
                                        ? "list"
                                        : "disc"
                                }
                                size={22}
                                color={colors.text}
                            />
                        }
                    />
                </View>
            }
        >
            <View className="absolute bottom-0 left-6 right-6 border-b border-border" />

            <View className="flex-1 overflow-hidden">
                <Text
                    className="text-base font-bold leading-tight text-foreground"
                    numberOfLines={1}
                >
                    {collection.title}
                </Text>
                <Text
                    className="mt-0.5 text-sm leading-tight text-muted-foreground"
                    numberOfLines={1}
                >
                    {subtitle}
                </Text>
            </View>

            <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </ZoomTile>
    );
}
