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

import { MusicList } from "@/components/custom/music-list";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { darken, useArtworkTint, withAlpha } from "@/lib/artwork-color";
import { getErrorMessage } from "@/lib/error-utils";
import { useZoomSource, ZoomDismissScreen } from "@/lib/zoom-dismiss";
import { collectionRoute } from "@/lib/music-routes";
import { useArtist } from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";

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
    const { playQueue } = usePlaybackCommands();
    const albums = artist?.albums ?? [];
    const topSongs = artist?.topSongs ?? [];
    // The wash runs the height of the whole page rather than the screen, so
    // scrolling moves through one gradient instead of repeating it. Until the
    // list has measured itself, a screen and a half is the better guess.
    const [contentHeight, setContentHeight] = useState(windowHeight * 1.5);
    const heroHeight = windowHeight * HERO_HEIGHT_RATIO;

    function openAlbum(album: MusicItem) {
        router.push(collectionRoute(album));
    }

    /** Replaces the queue with the top songs, in Apple's order. */
    function playTopSongs() {
        if (topSongs.length === 0) return;
        void playQueue({ tracks: topSongs });
    }

    return (
        <ZoomDismissScreen>
            {/* The tint rather than the flat card color, so overscrolling at
                the top uncovers the wash and not a gray ceiling. */}
            <View
                className="flex-1 bg-card"
                style={tint ? { backgroundColor: tint } : undefined}
            >
                {artistErr ? (
                    <Text className="my-2 px-6 text-center text-destructive">
                        {getErrorMessage(artistErr)}
                    </Text>
                ) : null}

                <MusicList
                    tracks={topSongs}
                    isLoading={artistLoading}
                    pagination={NO_PAGINATION}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    fullBleedRows
                    onContentSizeChange={(_, height) =>
                        setContentHeight(Math.max(windowHeight, height))
                    }
                    // Same as the collection screen: the backdrop runs past
                    // the header, and Android would detach it with the header.
                    removeClippedSubviews={false}
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
                                onPlay={playTopSongs}
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
                />

                {/* Floats over the hero rather than scrolling with it. Top right
                and an X, the same place and the same glyph every sheet in the
                app closes from, because this is the same gesture. */}
                <FloatingCloseButton label="Close artist" />
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
    onPlay,
}: {
    artist?: ArtistDetail;
    name: string;
    height: number;
    tint: string | null;
    fadeTo: string | null;
    canPlay: boolean;
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
                <PlayButton disabled={!canPlay} onPress={onPlay} />
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
    onPress,
}: {
    disabled: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Play top songs"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            className="h-14 w-14 items-center justify-center rounded-full bg-white active:opacity-80"
            style={{ opacity: disabled ? 0.4 : 1 }}
        >
            {/* Nudged right: a triangle looks off-center in a circle when its
                bounding box is centered. */}
            <Ionicons
                name="play"
                size={28}
                color="#000000"
                style={{ marginLeft: 3 }}
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
