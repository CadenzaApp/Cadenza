import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistItem } from "@apple-musickit";
import { useTheme } from "expo-router/react-navigation";
import { FlatList, Image, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";

import { MusicListItemSkeleton } from "@/components/custom/music-list/music-list-item";
import { ZoomTile } from "@/components/custom/zoom-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useScreenOverlayInsets } from "@/lib/screen-overlay";
import { useScreenScroll } from "@/lib/screen-scroll";
import { useTopRailInset } from "@/lib/top-rail";
import { ScreenScrollMarker } from "@/lib/screen-scroll-marker";
import { artistRoute } from "@/lib/music-routes";
import { cn } from "@/lib/utils";

const SKELETON_ROW_COUNT = 8;
const RAIL_TILE_WIDTH = 96;
const RAIL_PLACEHOLDER_COUNT = 4;

type ArtistListProps = {
    artists: ArtistItem[];
    isLoading: boolean;
    isLoadingNextPage: boolean;
    hasNextPage: boolean;
    onLoadNextPage: () => void;
    /** Runs as an artist opens, before the push. */
    onOpen?: (artist: ArtistItem) => void;
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
    onOpen,
    emptyLabel,
}: ArtistListProps) {
    const { listBottomInset } = useScreenOverlayInsets();
    const scroll = useScreenScroll<FlatList<ArtistItem>>();
    // the skeleton is not in the scroller, so the scroller's inset misses it
    const railInset = useTopRailInset();

    if (isLoading && artists.length === 0) {
        return (
            <View
                className="flex-1"
                style={{ paddingTop: railInset ?? undefined }}
            >
                {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
                    <MusicListItemSkeleton key={index} fullBleed />
                ))}
            </View>
        );
    }

    return (
        <ScreenScrollMarker>
            <Animated.FlatList
                {...scroll}
                className="flex-1"
                data={artists}
                keyExtractor={(artist) => artist.id}
                renderItem={({ item }) => (
                    <ArtistRow artist={item} onOpen={onOpen} />
                )}
                contentContainerStyle={[
                    { paddingBottom: listBottomInset },
                    scroll.contentContainerStyle,
                ]}
                ListEmptyComponent={
                    <Text className="px-6 py-10 text-center text-muted-foreground">
                        {emptyLabel}
                    </Text>
                }
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

type ArtistRailProps = {
    artists: ArtistItem[];
    isLoading: boolean;
    /** Runs as an artist opens, before the push. */
    onOpen?: (artist: ArtistItem) => void;
};

/**
 * The same artists sideways, for a section that sits above another list. It
 * scrolls horizontally on purpose: the surfaces that use it already own a
 * vertical scroll container, and nesting two would break both.
 */
export function ArtistRail({ artists, isLoading, onOpen }: ArtistRailProps) {
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
                          onOpen={onOpen}
                      />
                  ))}
        </ScrollView>
    );
}

/**
 * An artist with no catalog id has nowhere to go: the artist screen reads the
 * catalog. Its tile renders inert rather than opening an empty screen.
 */
function ArtistTile({
    artist,
    onOpen,
}: {
    artist: ArtistItem;
    onOpen?: (artist: ArtistItem) => void;
}) {
    const href = artistRoute(artist);

    return (
        <ZoomTile
            href={href}
            accessibilityRole="button"
            accessibilityLabel={`Open ${artist.name}`}
            disabled={!href}
            onPress={() => onOpen?.(artist)}
            style={{ width: RAIL_TILE_WIDTH }}
            className="active:opacity-80"
            artwork={
                <View collapsable={false} className="h-24 w-24">
                    <ArtistArtwork
                        artist={artist}
                        className="h-full w-full"
                        iconSize={32}
                    />
                </View>
            }
        >
            <Text
                numberOfLines={1}
                className="mt-2 text-center text-sm text-foreground"
            >
                {artist.name}
            </Text>
        </ZoomTile>
    );
}

function ArtistRow({
    artist,
    onOpen,
}: {
    artist: ArtistItem;
    onOpen?: (artist: ArtistItem) => void;
}) {
    const href = artistRoute(artist);

    return (
        <ZoomTile
            href={href}
            accessibilityRole="button"
            accessibilityLabel={`Open ${artist.name}`}
            disabled={!href}
            onPress={() => onOpen?.(artist)}
            className="relative flex-row items-center px-6 py-3 active:opacity-80"
            artwork={
                <View collapsable={false} className="mr-3 h-14 w-14">
                    <ArtistArtwork
                        artist={artist}
                        className="h-full w-full"
                        iconSize={22}
                    />
                </View>
            }
        >
            <View className="absolute bottom-0 left-6 right-6 border-b border-border" />
            <Text
                numberOfLines={1}
                className="flex-1 text-base text-foreground"
            >
                {artist.name}
            </Text>
        </ZoomTile>
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
