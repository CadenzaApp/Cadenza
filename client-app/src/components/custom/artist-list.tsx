import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import { FlatList, Image, Pressable, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";

import { MusicListItemSkeleton } from "@/components/custom/music-list/music-list-item";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { useZoomSource } from "@/lib/zoom-dismiss";
import { cn } from "@/lib/utils";

const SKELETON_ROW_COUNT = 8;
const RAIL_TILE_WIDTH = 96;
const RAIL_PLACEHOLDER_COUNT = 4;

/**
 * Whether this artist can open the artist screen. `/artist/[id]` reads the
 * catalog, so a library artist Apple knows no catalog equivalent for has
 * nowhere to go and renders inert rather than opening an empty screen.
 */
export function canOpenArtist(artist: ArtistItem): boolean {
    return Boolean(artist.catalogId);
}

type ArtistListProps = {
    artists: ArtistItem[];
    isLoading: boolean;
    isLoadingNextPage: boolean;
    hasNextPage: boolean;
    onLoadNextPage: () => void;
    onSelect: (artist: ArtistItem) => void;
    /** Shown when the list is loaded and empty. */
    emptyLabel: string;
};

/**
 * A paged vertical list of artists. The artist counterpart to
 * `CollectionList`, and simple for the same reason: an artist is not playable,
 * so sorting, multi-select, and the track menu all mean nothing here.
 */
export function ArtistList({
    artists,
    isLoading,
    isLoadingNextPage,
    hasNextPage,
    onLoadNextPage,
    onSelect,
    emptyLabel,
}: ArtistListProps) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<ArtistItem>>();

    if (isLoading && artists.length === 0) {
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
            data={artists}
            keyExtractor={(artist) => artist.id}
            renderItem={({ item }) => (
                <ArtistRow artist={item} onPress={onSelect} />
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

type ArtistRailProps = {
    artists: ArtistItem[];
    isLoading: boolean;
    onSelect: (artist: ArtistItem) => void;
};

/**
 * The same artists sideways, for a section that sits above another list. It
 * scrolls horizontally on purpose: the surfaces that use it already own a
 * vertical scroll container, and nesting two would break both.
 */
export function ArtistRail({ artists, isLoading, onSelect }: ArtistRailProps) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 16 }}
        >
            {isLoading && artists.length === 0
                ? Array.from({ length: RAIL_PLACEHOLDER_COUNT }, (_, index) => (
                      <View key={index} style={{ width: RAIL_TILE_WIDTH }}>
                          <Skeleton className="aspect-square w-full rounded-full" />
                          <Skeleton className="mt-2 h-4 w-3/4 self-center rounded" />
                      </View>
                  ))
                : artists.map((artist) => (
                      <ArtistTile
                          key={artist.id}
                          artist={artist}
                          onPress={onSelect}
                      />
                  ))}
        </ScrollView>
    );
}

function ArtistTile({
    artist,
    onPress,
}: {
    artist: ArtistItem;
    onPress: (artist: ArtistItem) => void;
}) {
    const openable = canOpenArtist(artist);
    const { ref: zoomRef, capture: captureZoom } = useZoomSource();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${artist.name}`}
            disabled={!openable}
            onPress={() => {
                captureZoom();
                onPress(artist);
            }}
            style={{ width: RAIL_TILE_WIDTH }}
            className="active:opacity-80"
        >
            <View ref={zoomRef} collapsable={false} className="h-24 w-24">
                <ArtistArtwork
                    artist={artist}
                    className="h-full w-full"
                    iconSize={32}
                />
            </View>
            <Text
                numberOfLines={1}
                className="mt-2 text-center text-sm text-foreground"
            >
                {artist.name}
            </Text>
        </Pressable>
    );
}

function ArtistRow({
    artist,
    onPress,
}: {
    artist: ArtistItem;
    onPress: (artist: ArtistItem) => void;
}) {
    const openable = canOpenArtist(artist);
    const { ref: zoomRef, capture: captureZoom } = useZoomSource();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${artist.name}`}
            disabled={!openable}
            onPress={() => {
                captureZoom();
                onPress(artist);
            }}
            className="relative flex-row items-center px-6 py-3 active:opacity-80"
        >
            <View className="absolute bottom-0 left-6 right-6 border-b border-border" />

            <View ref={zoomRef} collapsable={false} className="mr-3 h-14 w-14">
                <ArtistArtwork
                    artist={artist}
                    className="h-full w-full"
                    iconSize={22}
                />
            </View>
            <Text
                numberOfLines={1}
                className="flex-1 text-base text-foreground"
            >
                {artist.name}
            </Text>
        </Pressable>
    );
}

/** Round artwork, or a person glyph when Apple has none. Artists are circles. */
function ArtistArtwork({
    artist,
    className,
    iconSize,
}: {
    artist: ArtistItem;
    className: string;
    iconSize: number;
}) {
    const { colors } = useTheme();
    const artworkUrl = artist.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    if (canRenderArtwork) {
        return (
            <Image
                source={{ uri: artworkUrl }}
                className={cn(
                    className,
                    "shrink-0 aspect-square rounded-full bg-muted",
                )}
            />
        );
    }

    return (
        <View
            className={cn(
                className,
                "shrink-0 aspect-square items-center justify-center rounded-full bg-muted",
            )}
        >
            <Ionicons name="person" size={iconSize} color={colors.text} />
        </View>
    );
}
