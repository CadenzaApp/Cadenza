import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import { FlatList, Image, Pressable, View } from "react-native";
import Animated from "react-native-reanimated";

import { MusicListItemSkeleton } from "@/components/custom/music-list/music-list-item";
import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { useZoomSource } from "@/lib/zoom-dismiss";
import { cn } from "@/lib/utils";

const SKELETON_ROW_COUNT = 8;

type CollectionListProps = {
    collections: MusicItem[];
    isLoading: boolean;
    isLoadingNextPage: boolean;
    hasNextPage: boolean;
    onLoadNextPage: () => void;
    onSelect: (collection: MusicItem) => void;
    /** Shown when the list is loaded and empty. */
    emptyLabel: string;
};

/**
 * A paged list of albums or playlists. Deliberately much simpler than
 * `MusicList`: sorting, multi-select, tagging, and the track menu all describe
 * songs, and none of them mean anything for a collection. Tapping a row opens
 * the collection rather than playing it.
 */
export function CollectionList({
    collections,
    isLoading,
    isLoadingNextPage,
    hasNextPage,
    onLoadNextPage,
    onSelect,
    emptyLabel,
}: CollectionListProps) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<MusicItem>>();

    if (isLoading && collections.length === 0) {
        return (
            <View className="flex-1">
                {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                    <MusicListItemSkeleton key={index} fullBleed />
                ))}
            </View>
        );
    }

    return (
        <Animated.FlatList
            {...scroll}
            className="flex-1"
            data={collections}
            keyExtractor={(collection) => collection.id}
            renderItem={({ item }) => (
                <CollectionListItem collection={item} onPress={onSelect} />
            )}
            contentContainerStyle={{ paddingBottom: listBottomInset }}
            ListEmptyComponent={
                <Text className="px-6 py-10 text-center text-muted-foreground">
                    {emptyLabel}
                </Text>
            }
            ListFooterComponent={
                isLoadingNextPage ? <MusicListItemSkeleton fullBleed /> : null
            }
            onEndReached={() => {
                if (hasNextPage && !isLoadingNextPage) onLoadNextPage();
            }}
            onEndReachedThreshold={0.1}
            showsVerticalScrollIndicator={false}
        />
    );
}

function CollectionListItem({
    collection,
    onPress,
}: {
    collection: MusicItem;
    onPress: (collection: MusicItem) => void;
}) {
    const { colors } = useTheme();
    const { ref: zoomRef, capture: captureZoom } = useZoomSource();
    const artworkUrl = collection.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);
    // Playlists carry a curator in artistName and often no one at all.
    const subtitle =
        collection.artistName ??
        (collection.resourceKind === "playlist" ? "Playlist" : "Album");

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${collection.title}`}
            onPress={() => {
                // The screen that opens minimizes back into this artwork, so
                // the rect has to be measured before the push.
                captureZoom();
                onPress(collection);
            }}
            className="relative flex-row items-center px-6 py-3 active:opacity-80"
        >
            <View className="absolute bottom-0 left-6 right-6 border-b border-border" />

            {/* `collapsable={false}` keeps the view around on Android, which
                is what `measureInWindow` needs to have something to measure. */}
            <View
                ref={zoomRef}
                collapsable={false}
                className="mr-3 h-14 w-14 shrink-0"
            >
                {canRenderArtwork ? (
                    <Image
                        source={{ uri: artworkUrl }}
                        className="h-full w-full aspect-square rounded bg-muted"
                    />
                ) : (
                    <View
                        className={cn(
                            "h-full w-full aspect-square items-center justify-center rounded bg-muted",
                        )}
                    >
                        <Ionicons
                            name={
                                collection.resourceKind === "playlist"
                                    ? "list"
                                    : "disc"
                            }
                            size={22}
                            color={colors.text}
                        />
                    </View>
                )}
            </View>

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
        </Pressable>
    );
}
