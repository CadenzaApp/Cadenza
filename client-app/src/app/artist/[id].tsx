import MaskedView from "@react-native-masked-view/masked-view";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistDetail, MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useColorScheme } from "nativewind";
import { memo, useCallback, useMemo, useState } from "react";
import {
    FlatList,
    Pressable,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ContrastRegion,
    ContrastText as Text,
} from "@/lib/surface-contrast-context";
import { useArtworkTint } from "@/lib/artwork-color";
import {
    createArtistGradient,
    ARTIST_ARTWORK_FADE_START,
    ARTIST_GRADIENT_SCREEN_HEIGHTS,
} from "@/lib/artwork-color-utils";
import { useZoomSource, ZoomDismissScreen } from "@/lib/zoom-dismiss";
import { MediaPlayerZoomOverlay } from "@/components/custom/media-player";
import { collectionRoute } from "@/lib/music-routes";
import { useArtist } from "@/lib/musickit-hooks";
import { samePlayableItem } from "@/lib/playable-item";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { useOpenTransitionSettled } from "@/lib/use-open-transition-settled";
import { useOpenScreen } from "@/lib/open-screen";

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
/** Height of the hero, as a fraction of the window height. Apple's is about this. */
const HERO_HEIGHT_RATIO = 0.45;

/**
 * One catalog artist: the artist image full bleed, their top songs, then their
 * albums. Apple's order, with a background sampled from the artist portrait.
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
    const openScreen = useOpenScreen();
    const { colorScheme = "light" } = useColorScheme();
    const { height: windowHeight } = useWindowDimensions();
    const { artist, artistLoading, artistErr } = useArtist(id);
    const { tint: portraitTint } = useArtworkTint(artist);
    const { activeTrack, isLoading, isPlaying } = usePlaybackTrackState();
    const { playQueue, togglePlayback } = usePlaybackCommands();
    const [playbackCommandPending, setPlaybackCommandPending] = useState(false);
    const albums = artist?.albums ?? EMPTY_ALBUMS;
    const topSongs = artist?.topSongs ?? EMPTY_TRACKS;
    const gradient = useMemo(
        () =>
            portraitTint
                ? createArtistGradient(portraitTint, colorScheme)
                : null,
        [portraitTint, colorScheme],
    );
    const isCurrentArtist =
        activeTrack != null &&
        (activeTrack.artistId === id ||
            topSongs.some((song) => samePlayableItem(song, activeTrack)));
    const isArtistPlaying = isCurrentArtist && isPlaying;
    const heroHeight = windowHeight * HERO_HEIGHT_RATIO;
    const loadingColor = colorScheme === "dark" ? "#000000" : "#ffffff";
    const artworkSurface = useMemo(
        () =>
            portraitTint
                ? {
                      color: portraitTint,
                      height: heroHeight,
                      fadeStart: ARTIST_ARTWORK_FADE_START,
                  }
                : undefined,
        [portraitTint, heroHeight],
    );

    const openAlbum = useCallback(
        (album: MusicItem) => {
            openScreen(collectionRoute(album));
        },
        [openScreen],
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
        <ZoomDismissScreen overlay={<MediaPlayerZoomOverlay />}>
            <View className="flex-1" style={{ backgroundColor: loadingColor }}>
                {artistErr ? <ErrorNotice error={artistErr} /> : null}

                <TrackCollectionView
                    title={artist?.name ?? name ?? "Artist"}
                    tracks={topSongs}
                    isLoading={artistLoading}
                    error={artistErr}
                    pagination={NO_PAGINATION}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    backgroundColor={portraitTint}
                    backgroundGradient={gradient}
                    gradientMinHeight={
                        windowHeight * ARTIST_GRADIENT_SCREEN_HEIGHTS
                    }
                    artworkSurface={artworkSurface}
                    header={
                        <>
                            <ArtistHero
                                artist={artist}
                                artistLoading={artistLoading}
                                name={artist?.name ?? name ?? "Artist"}
                                height={heroHeight}
                                canPlay={topSongs.length > 0}
                                isPlaying={isArtistPlaying}
                                isLoading={isLoading || playbackCommandPending}
                                onPlay={() => void playTopSongs()}
                            />
                            <ContrastRegion offset={heroHeight + 30}>
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
                                    onSelect={openAlbum}
                                />
                            </View>
                        ) : null
                    }
                    closeControl={<FloatingCloseButton label="Close artist" />}
                />
            </View>
        </ZoomDismissScreen>
    );
}

/**
 * The artist image, run to every edge and under the status bar, with the name
 * and the play button over the bottom of it. The image fades into the page
 * color rather than ending on a hard line.
 *
 * `expo-image` rather than the React Native one: it caches to disk, decodes off
 * the JS thread, and can show the small artwork while the hero-sized one is
 * still coming down. A 1200px image over a slow connection is otherwise a blank
 * rectangle for a few seconds, with the tint already painted around it.
 */
function ArtistHero({
    artist,
    artistLoading,
    name,
    height,
    canPlay,
    isPlaying,
    isLoading,
    onPlay,
}: {
    artist?: ArtistDetail;
    artistLoading: boolean;
    name: string;
    height: number;
    canPlay: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    onPlay: () => void;
}) {
    const { colors } = useTheme();
    const artworkUrl = artist?.artworkUrl;

    return (
        <View style={{ height }} className="justify-end">
            <MaskedView
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
                // Cache this static image+mask composite while the parent scrolls.
                shouldRasterizeIOS
                renderToHardwareTextureAndroid
                maskElement={
                    <LinearGradient
                        style={StyleSheet.absoluteFill}
                        colors={["#000000", "#000000", "transparent"]}
                        locations={[0, ARTIST_ARTWORK_FADE_START, 1]}
                    />
                }
            >
                {artworkUrl ? (
                    <Image
                        source={{ uri: artworkUrl }}
                        placeholder={
                            artist?.artworkUrlSmall
                                ? { uri: artist.artworkUrlSmall }
                                : undefined
                        }
                        placeholderContentFit="cover"
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        priority="high"
                        transition={0}
                        style={{ position: "absolute", inset: 0 }}
                    />
                ) : artistLoading ? (
                    <Skeleton className="absolute inset-0" />
                ) : (
                    <View className="absolute inset-0 items-center justify-center bg-muted">
                        <Ionicons name="person" size={72} color={colors.text} />
                    </View>
                )}
            </MaskedView>

            <ContrastRegion offset={height - 100}>
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
        </View>
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
    onSelect,
}: {
    albums: MusicItem[];
    isLoading: boolean;
    onSelect: (album: MusicItem) => void;
}) {
    const settled = useOpenTransitionSettled(true);
    const { fontScale } = useWindowDimensions();
    const renderAlbum = useCallback(
        ({ item }: { item: MusicItem }) => (
            <AlbumTile album={item} onSelect={onSelect} />
        ),
        [onSelect],
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

const AlbumTile = memo(function AlbumTile({
    album,
    onSelect,
}: {
    album: MusicItem;
    onSelect: (album: MusicItem) => void;
}) {
    const { colors } = useTheme();
    const { ref: zoomRef, capture: captureZoom } = useZoomSource();
    const artworkUrl = album.artworkUrl?.trim();
    const canRenderArtwork =
        typeof artworkUrl === "string" && /^https?:\/\//i.test(artworkUrl);

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${album.title}`}
            onPress={() => {
                captureZoom();
                onSelect(album);
            }}
            style={{ width: ALBUM_TILE_WIDTH }}
            className="active:opacity-80"
        >
            <View
                ref={zoomRef}
                collapsable={false}
                className="aspect-square w-full"
            >
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
                        <Ionicons name="disc" size={28} color={colors.text} />
                    </View>
                )}
            </View>
            <Text
                className="mt-2 text-sm font-semibold text-foreground"
                numberOfLines={2}
            >
                {album.title}
            </Text>
        </Pressable>
    );
});
