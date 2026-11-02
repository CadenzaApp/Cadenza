import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistDetail, MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import { memo, useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, useWindowDimensions, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import {
    CoverHero,
    useCoverHeroLayout,
    type CoverHeroLayout,
} from "@/components/custom/cover-hero";
import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { FloatingBackButton } from "@/components/ui/floating-back-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ContrastRegion,
    ContrastText as Text,
} from "@/lib/surface-contrast-context";
import { useArtworkTint, useCoverPageColor } from "@/lib/artwork-color";
import { flatGradient } from "@/lib/artwork-color-utils";
import { collectionRoute } from "@/lib/music-routes";
import { useArtist } from "@/lib/musickit-hooks";
import { samePlayableItem } from "@/lib/playable-item";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { useOpenTransitionSettled } from "@/lib/use-open-transition-settled";
import { ZoomTile } from "@/components/custom/zoom-tile";

const EMPTY_TRACKS: MusicItem[] = [];
const ALBUM_TILE_WIDTH = 132;
const ALBUM_PLACEHOLDER_COUNT = 4;
const EMPTY_ALBUMS: MusicItem[] = [];
const ALBUM_TILE_GAP = 12;
const ALBUM_RAIL_INSET = 24;
const ALBUM_RAIL_STYLE = { paddingHorizontal: ALBUM_RAIL_INSET };
const ALBUM_IMAGE_STYLE = { width: ALBUM_TILE_WIDTH, height: ALBUM_TILE_WIDTH };
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
const NO_PAGINATION = {
    hasNextPage: false,
    isLoadingNextPage: false,
    onLoadNextPage: () => undefined,
} as const;
/** How far above the hero's bottom the name sits, for the contrast sample. */
const HERO_NAME_INSET = 100;

/**
 * One catalog artist: the artist image full bleed, their top songs, then their
 * albums. Apple's order, on a flat page colored from the portrait's bottom
 * half, the same hero as an album.
 *
 * The whole page is one `MusicList`. It owns a `FlatList`, so the hero goes in
 * as its header and the albums rail as its footer; stacking a `ScrollView`
 * around it would nest two scroll containers and neither would behave. The
 * albums rail scrolls sideways for the same reason.
 *
 * Catalog only: a library song with no catalog equivalent has no artist ID to
 * arrive here with, and the rows that lead here are disabled for it.
 */
export default function ArtistScreen() {
    const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
    const { colorScheme = "light" } = useColorScheme();
    const { artist, artistLoading, artistErr } = useArtist(id);
    const { tint: portraitTint } = useArtworkTint(artist);
    const { activeTrack, isLoading, isPlaying } = usePlaybackTrackState();
    const { playQueue, togglePlayback } = usePlaybackCommands();
    const [playbackCommandPending, setPlaybackCommandPending] = useState(false);
    const albums = artist?.albums ?? EMPTY_ALBUMS;
    const topSongs = artist?.topSongs ?? EMPTY_TRACKS;
    const heroLayout = useCoverHeroLayout();
    const pageColor = useCoverPageColor(
        artist?.artworkUrlSmall ?? artist?.artworkUrl,
        portraitTint,
    );
    const gradient = useMemo(
        () => (pageColor ? flatGradient(pageColor) : null),
        [pageColor],
    );
    const isCurrentArtist =
        activeTrack != null &&
        (activeTrack.artistId === id ||
            topSongs.some((song) => samePlayableItem(song, activeTrack)));
    const isArtistPlaying = isCurrentArtist && isPlaying;
    const loadingColor = colorScheme === "dark" ? "#000000" : "#ffffff";
    const artworkSurface = useMemo(
        () =>
            pageColor
                ? {
                      color: pageColor,
                      height: heroLayout.height,
                      fadeStart: heroLayout.fadeStart,
                  }
                : undefined,
        [pageColor, heroLayout.height, heroLayout.fadeStart],
    );

    /** Replaces the queue with the top songs, in Apple's order. */
    async function playTopSongs() {
        if (topSongs.length === 0 || playbackCommandPending) return;
        setPlaybackCommandPending(true);
        try {
            if (isCurrentArtist && activeTrack) {
                await togglePlayback(activeTrack);
                return;
            }
            await playQueue({ tracks: topSongs });
        } finally {
            setPlaybackCommandPending(false);
        }
    }

    return (
        <View className="flex-1" style={{ backgroundColor: loadingColor }}>
            {artistErr ? <ErrorNotice error={artistErr} /> : null}

            <TrackCollectionView
                title={artist?.name ?? name ?? "Artist"}
                tracks={topSongs}
                isLoading={artistLoading}
                error={artistErr}
                pagination={NO_PAGINATION}
                multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                backgroundColor={pageColor}
                backgroundGradient={gradient}
                artworkSurface={artworkSurface}
                header={
                    <>
                        <ArtistHero
                            artist={artist}
                            artistLoading={artistLoading}
                            name={artist?.name ?? name ?? "Artist"}
                            layout={heroLayout}
                            canPlay={topSongs.length > 0}
                            isPlaying={isArtistPlaying}
                            isLoading={isLoading || playbackCommandPending}
                            onPlay={() => void playTopSongs()}
                        />
                        <ContrastRegion offset={heroLayout.height + 30}>
                            <Text className="px-6 pb-1 pt-5 text-xl font-bold text-foreground">
                                Top Songs
                            </Text>
                        </ContrastRegion>
                    </>
                }
                footer={
                    artistLoading || albums.length > 0 ? (
                        <View className="pt-6">
                            <Text className="px-6 pb-3 text-xl font-bold text-foreground">
                                Albums
                            </Text>
                            <AlbumRail
                                albums={albums}
                                isLoading={artistLoading}
                            />
                        </View>
                    ) : null
                }
                backControl={<FloatingBackButton />}
            />
        </View>
    );
}

/**
 * The artist image as a `CoverHero`, with the name and the play button over
 * the bottom of it.
 */
function ArtistHero({
    artist,
    artistLoading,
    name,
    layout,
    canPlay,
    isPlaying,
    isLoading,
    onPlay,
}: {
    artist?: ArtistDetail;
    artistLoading: boolean;
    name: string;
    layout: CoverHeroLayout;
    canPlay: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    onPlay: () => void;
}) {
    const { colors } = useTheme();
    const artworkUrl = artist?.artworkUrl;

    return (
        <CoverHero
            layout={layout}
            uri={artworkUrl}
            placeholderUri={artist?.artworkUrlSmall}
            fallback={
                artistLoading ? (
                    <Skeleton className="absolute inset-0" />
                ) : (
                    <View className="absolute inset-0 items-center justify-center bg-muted">
                        <Ionicons name="person" size={72} color={colors.text} />
                    </View>
                )
            }
        >
            <ContrastRegion offset={layout.height - HERO_NAME_INSET}>
                <View className="items-center px-6 pb-5">
                    <Text
                        className="pb-4 text-center text-4xl font-bold tracking-tight text-white"
                        numberOfLines={2}
                    >
                        {name}
                    </Text>
                    <PlayButton
                        disabled={!canPlay || isLoading}
                        isPlaying={isPlaying}
                        onPress={onPlay}
                    />
                </View>
            </ContrastRegion>
        </CoverHero>
    );
}

/**
 * Plays the artist's top songs. It replaces the queue rather than adding to it,
 * which is what the same button does in Music.
 */
function PlayButton({
    disabled,
    isPlaying,
    onPress,
}: {
    disabled: boolean;
    isPlaying: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={
                isPlaying ? "Pause top songs" : "Play top songs"
            }
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            className="h-14 w-14 items-center justify-center rounded-full bg-white active:opacity-80"
            style={{ opacity: disabled ? 0.4 : 1 }}
        >
            {/* Nudged right: a triangle looks off-center in a circle when its
                bounding box is centered. */}
            <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={28}
                color="#000000"
                style={isPlaying ? undefined : { marginLeft: 3 }}
            />
        </Pressable>
    );
}

/** Only mount nearby covers; large artist catalogs can contain hundreds of albums. */
const AlbumRail = memo(function AlbumRail({
    albums,
    isLoading,
}: {
    albums: MusicItem[];
    isLoading: boolean;
}) {
    const settled = useOpenTransitionSettled(true);
    const { fontScale } = useWindowDimensions();
    const renderAlbum = useCallback(
        ({ item }: { item: MusicItem }) => <AlbumTile album={item} />,
        [],
    );
    return (
        <FlatList
            horizontal
            style={{ height: ALBUM_TILE_WIDTH + 8 + 44 * fontScale }}
            data={settled ? albums : EMPTY_ALBUMS}
            keyExtractor={albumKey}
            renderItem={renderAlbum}
            getItemLayout={albumLayout}
            initialNumToRender={ALBUM_PLACEHOLDER_COUNT}
            maxToRenderPerBatch={ALBUM_PLACEHOLDER_COUNT}
            windowSize={3}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ALBUM_RAIL_STYLE}
            ItemSeparatorComponent={AlbumSeparator}
            ListEmptyComponent={
                isLoading || !settled ? <AlbumPlaceholders /> : null
            }
        />
    );
});

function albumKey(album: MusicItem) {
    return album.id;
}
function albumLayout(
    _data: ArrayLike<MusicItem> | null | undefined,
    index: number,
) {
    return {
        length: ALBUM_TILE_WIDTH,
        offset: ALBUM_RAIL_INSET + index * (ALBUM_TILE_WIDTH + ALBUM_TILE_GAP),
        index,
    };
}
function AlbumSeparator() {
    return <View style={{ width: ALBUM_TILE_GAP }} />;
}
function AlbumPlaceholders() {
    return (
        <View className="flex-row" style={{ gap: ALBUM_TILE_GAP }}>
            {Array.from({ length: ALBUM_PLACEHOLDER_COUNT }, (_, index) => (
                <View key={index} style={{ width: ALBUM_TILE_WIDTH }}>
                    <Skeleton className="aspect-square w-full rounded-lg" />
                    <Skeleton className="mt-2 h-4 w-3/4 rounded" />
                </View>
            ))}
        </View>
    );
}

const AlbumTile = memo(function AlbumTile({ album }: { album: MusicItem }) {
    const { colors } = useTheme();
    const artworkUrl = album.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    return (
        <ZoomTile
            href={collectionRoute(album)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${album.title}`}
            style={{ width: ALBUM_TILE_WIDTH }}
            className="active:opacity-80"
            artwork={
                <View collapsable={false} className="aspect-square w-full">
                    {canRenderArtwork ? (
                        <Image
                            source={{ uri: artworkUrl }}
                            style={ALBUM_IMAGE_STYLE}
                            className="rounded-lg bg-muted"
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={album.id}
                            transition={0}
                        />
                    ) : (
                        <View className="h-full w-full items-center justify-center rounded-lg bg-muted">
                            <Ionicons
                                name="disc"
                                size={28}
                                color={colors.text}
                            />
                        </View>
                    )}
                </View>
            }
        >
            <Text
                className="mt-2 text-sm font-semibold text-foreground"
                numberOfLines={2}
            >
                {album.title}
            </Text>
        </ZoomTile>
    );
});
