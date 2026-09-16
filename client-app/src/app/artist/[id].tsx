import Ionicons from "@expo/vector-icons/Ionicons";
import type { ArtistDetail, MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import {
    Image as RNImage,
    Pressable,
    ScrollView,
    useWindowDimensions,
    View,
} from "react-native";

import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { darken, useArtworkTint, withAlpha } from "@/lib/artwork-color";
import { getErrorMessage } from "@/lib/error-utils";
import { useZoomSource, ZoomDismissScreen } from "@/lib/zoom-dismiss";
import { collectionRoute } from "@/lib/music-routes";
import { useArtist } from "@/lib/musickit-hooks";
import { samePlayableItem } from "@/lib/playable-item";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";

const ALBUM_TILE_WIDTH = 132;
const ALBUM_PLACEHOLDER_COUNT = 4;
const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
const NO_PAGINATION = {
    hasNextPage: false,
    isLoadingNextPage: false,
    onLoadNextPage: () => undefined,
} as const;
/** Height of the hero, as a fraction of the window height. Apple's is about this. */
const HERO_HEIGHT_RATIO = 0.45;
/** How much of the hero the name sits over, fading the image into the page. */
const HERO_FADE_RATIO = 0.45;
/** Brightness the page bottoms out at. Shared with the hero, so they meet. */
const TINT_DEPTH = 0.3;

/**
 * One catalog artist: the artist image full bleed, their top songs, then their
 * albums. Apple's order, and Apple's tint, which comes from the artwork.
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
    const router = useRouter();
    const { height: windowHeight } = useWindowDimensions();
    const { artist, artistLoading, artistErr } = useArtist(id);
    const { tint } = useArtworkTint(artist);
    const { activeTrack, isLoading, isPlaying } = usePlaybackTrackState();
    const { playQueue, togglePlayback } = usePlaybackCommands();
    const [playbackCommandPending, setPlaybackCommandPending] = useState(false);
    const albums = artist?.albums ?? [];
    const topSongs = artist?.topSongs ?? [];
    const isCurrentArtist =
        activeTrack != null &&
        (activeTrack.artistId === id ||
            topSongs.some((song) => samePlayableItem(song, activeTrack)));
    const isArtistPlaying = isCurrentArtist && isPlaying;
    // The wash runs the height of the whole page rather than the screen, so
    // scrolling moves through one gradient instead of repeating it. Until the
    // list has measured itself, a screen and a half is the better guess.
    const [contentHeight, setContentHeight] = useState(windowHeight * 1.5);
    const heroHeight = windowHeight * HERO_HEIGHT_RATIO;

    function openAlbum(album: MusicItem) {
        router.push(collectionRoute(album));
    }

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
        <ZoomDismissScreen>
            <View className="flex-1 bg-card">
                {artistErr ? (
                    <Text className="my-2 px-6 text-center text-destructive">
                        {getErrorMessage(artistErr)}
                    </Text>
                ) : null}

                <TrackCollectionView
                    title={artist?.name ?? name ?? "Artist"}
                    tracks={topSongs}
                    isLoading={artistLoading}
                    error={artistErr}
                    pagination={NO_PAGINATION}
                    sorting={null}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    overscrollBackground={
                        <TintBackdrop tint={tint} depth={TINT_DEPTH} />
                    }
                    onContentSizeChange={(_, height) =>
                        setContentHeight(Math.max(windowHeight, height))
                    }
                    header={
                        <>
                            {/* Inside the header, so it scrolls with the content it
                            is painted behind. Rows draw no background of their
                            own, so it shows through all the way down. */}
                            <TintBackdrop
                                tint={tint}
                                height={contentHeight}
                                depth={TINT_DEPTH}
                            />
                            <ArtistHero
                                artist={artist}
                                name={artist?.name ?? name ?? "Artist"}
                                height={heroHeight}
                                tint={tint}
                                // Where the page's own gradient has reached by the
                                // bottom of the hero, so the image fades into the
                                // page rather than into a brighter band.
                                fadeTo={
                                    tint
                                        ? darken(
                                              tint,
                                              1 -
                                                  (1 - TINT_DEPTH) *
                                                      (heroHeight /
                                                          contentHeight),
                                          )
                                        : null
                                }
                                canPlay={topSongs.length > 0}
                                isPlaying={isArtistPlaying}
                                isLoading={isLoading || playbackCommandPending}
                                onPlay={() => void playTopSongs()}
                            />
                            <Text className="px-6 pb-1 pt-5 text-xl font-bold text-foreground">
                                Top Songs
                            </Text>
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
    name,
    height,
    tint,
    fadeTo,
    canPlay,
    isPlaying,
    isLoading,
    onPlay,
}: {
    artist?: ArtistDetail;
    name: string;
    height: number;
    tint: string | null;
    fadeTo: string | null;
    canPlay: boolean;
    isPlaying: boolean;
    isLoading: boolean;
    onPlay: () => void;
}) {
    const { colors } = useTheme();
    const artworkUrl = artist?.artworkUrl;
    // `colors.card` is a ColorValue, which is a hex string on every theme the
    // app defines. The gradient wants that string.
    const fadeColor = fadeTo ?? String(colors.card);

    return (
        <View style={{ height }} className="justify-end">
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
                    transition={200}
                    style={{ position: "absolute", inset: 0 }}
                />
            ) : (
                <View className="absolute inset-0 items-center justify-center bg-muted">
                    <Ionicons name="person" size={72} color={colors.text} />
                </View>
            )}

            <LinearGradient
                pointerEvents="none"
                colors={[withAlpha(tint ?? "#000000", 0), fadeColor]}
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: height * HERO_FADE_RATIO,
                }}
            />

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

/** The artist's albums, sideways. */
function AlbumRail({
    albums,
    isLoading,
    onSelect,
}: {
    albums: MusicItem[];
    isLoading: boolean;
    onSelect: (album: MusicItem) => void;
}) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}
        >
            {isLoading && albums.length === 0
                ? Array.from(
                      { length: ALBUM_PLACEHOLDER_COUNT },
                      (_, index) => (
                          <View key={index} style={{ width: ALBUM_TILE_WIDTH }}>
                              <Skeleton className="aspect-square w-full rounded-lg" />
                              <Skeleton className="mt-2 h-4 w-3/4 rounded" />
                          </View>
                      ),
                  )
                : albums.map((album) => (
                      <AlbumTile
                          key={album.id}
                          album={album}
                          onPress={() => onSelect(album)}
                      />
                  ))}
        </ScrollView>
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
                onPress();
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
                    <RNImage
                        source={{ uri: artworkUrl }}
                        className="h-full w-full rounded-lg bg-muted"
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
}
