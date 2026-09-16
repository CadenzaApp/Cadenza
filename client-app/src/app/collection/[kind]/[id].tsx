import Ionicons from "@expo/vector-icons/Ionicons";
import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { type ComponentProps, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MusicList } from "@/components/custom/music-list";
import { CollectionOptionsMenu } from "@/components/custom/options-menu/collection-options-menu";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { GlassIconButton } from "@/components/ui/glass-icon-button";
import { Text } from "@/components/ui/text";
import { TintBackdrop } from "@/components/ui/tint-backdrop";
import { useArtworkTint } from "@/lib/artwork-color";
import { getErrorMessage } from "@/lib/error-utils";
import { useCollectionSongs } from "@/lib/musickit-hooks";
import { isTrackInCollection } from "@/lib/playable-item";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { ZoomDismissScreen } from "@/lib/zoom-dismiss";

import type { LibraryCollectionKind } from "@/lib/musickit-hooks";

const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
/** Cover width, as a fraction of the window. Apple's is about this. */
const COVER_WIDTH_RATIO = 0.6;
const COVER_MAX_WIDTH = 280;
/** Height of the Play button, and so the diameter of the circles beside it. */
const HERO_BUTTON_SIZE = 52;
/**
 * Width of the whole button row, as a fraction of the window. Music's Play is
 * narrower than the content column, so the row is sized rather than stretched.
 */
const BUTTON_ROW_WIDTH_RATIO = 0.74;
/** Brightness the page bottoms out at. Shared with the artist screen. */
const TINT_DEPTH = 0.3;
/**
 * Everything drawn over the cover is white, on every tint. The wash is dark
 * enough at any color, and text that flips to black on a pale album is a
 * screen that changes shape depending on what you tapped.
 */
const HERO_FOREGROUND = "#ffffff";

/**
 * The songs inside one library album or playlist. Both kinds render the same
 * way, so the kind is a route param rather than two screens.
 *
 * Laid out like the artist screen, and for the same reason: the whole page is
 * one `MusicList`, which owns a `FlatList`, so the cover and the buttons go in
 * as its header rather than as a sibling above it. Wrapping it in a
 * `ScrollView` would nest two scroll containers and neither would behave.
 */
export default function CollectionDetailScreen() {
    const {
        kind,
        id,
        title,
        artistName,
        artworkColor,
        artworkUrl,
        artworkUrlLarge,
    } = useLocalSearchParams<{
        kind: LibraryCollectionKind;
        id: string;
        title?: string;
        artistName?: string;
        artworkColor?: string;
        artworkUrl?: string;
        artworkUrlLarge?: string;
    }>();
    const insets = useSafeAreaInsets();
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const { activeTrack, isPlaying } = usePlaybackTrackState();
    const { playQueue, setShuffleMode, togglePlayback } = usePlaybackCommands();
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [playbackCommandPending, setPlaybackCommandPending] = useState(false);
    const {
        tracks,
        tracksLoading,
        tracksLoadingNextPage,
        loadNextCollectionPage,
        hasNextCollectionPage,
        tracksErr,
    } = useCollectionSongs(kind, id);
    const firstTrack = tracks[0];
    const isCurrentCollection =
        activeTrack != null &&
        isTrackInCollection(activeTrack, id, kind, tracks);
    const isCollectionPlaying = isCurrentCollection && isPlaying;
    // The caller knows the cover and hands it over, so the color is there on
    // the first frame. A deep link arrives with neither, and the first track's
    // artwork is the same cover.
    const { tint } = useArtworkTint({
        artworkColor: artworkColor ?? firstTrack?.artworkColor,
        artworkUrl: artworkUrl ?? firstTrack?.artworkUrl,
    });
    // Same reason as the artist screen: the wash runs the height of the whole
    // page, so scrolling moves through one gradient instead of repeating it.
    const [contentHeight, setContentHeight] = useState(windowHeight * 1.5);
    const coverWidth = Math.min(
        windowWidth * COVER_WIDTH_RATIO,
        COVER_MAX_WIDTH,
    );
    const buttonRowWidth = windowWidth * BUTTON_ROW_WIDTH_RATIO;
    // Only once every page is in. A count off a half-loaded list is a wrong
    // number, which is worse than no number.
    const summary =
        tracksLoading || hasNextCollectionPage
            ? undefined
            : collectionSummary(tracks);

    /** Plays the collection from the top, replacing the queue. */
    async function play() {
        if (tracks.length === 0 || playbackCommandPending) return;
        setPlaybackCommandPending(true);
        try {
            if (isCurrentCollection && activeTrack) {
                await togglePlayback(activeTrack);
                return;
            }
            await setShuffleMode(ShuffleMode.Off);
            await playQueue({ tracks });
        } finally {
            setPlaybackCommandPending(false);
        }
    }

    /** The same queue, shuffled, starting somewhere other than the first song. */
    async function shuffle() {
        if (tracks.length === 0 || playbackCommandPending) return;
        setPlaybackCommandPending(true);
        try {
            await setShuffleMode(ShuffleMode.Songs);
            await playQueue({
                tracks,
                startIndex: Math.floor(Math.random() * tracks.length),
            });
        } finally {
            setPlaybackCommandPending(false);
        }
    }

    return (
        <ZoomDismissScreen>
            {/* The tint, not just the gradient inside the list: pulling the
                list down past the top would otherwise uncover the flat card
                color above the artwork. */}
            <View
                className="flex-1 bg-card"
                style={tint ? { backgroundColor: tint } : undefined}
            >
                {tracksErr ? (
                    <Text className="my-2 px-6 text-center text-destructive">
                        {getErrorMessage(tracksErr)}
                    </Text>
                ) : null}

                <MusicList
                    tracks={tracks}
                    isLoading={tracksLoading}
                    pagination={{
                        hasNextPage: hasNextCollectionPage,
                        isLoadingNextPage: tracksLoadingNextPage,
                        onLoadNextPage: loadNextCollectionPage,
                    }}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    fullBleedRows
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
                            <CollectionHero
                                title={
                                    title ??
                                    (kind === "playlist" ? "Playlist" : "Album")
                                }
                                subtitle={artistName ?? firstTrack?.artistName}
                                meta={collectionMeta(firstTrack)}
                                artworkUrl={
                                    artworkUrlLarge ??
                                    firstTrack?.artworkUrlLarge ??
                                    artworkUrl ??
                                    firstTrack?.artworkUrl
                                }
                                coverWidth={coverWidth}
                                buttonRowWidth={buttonRowWidth}
                                // Clears the floating X, which is not laid out.
                                paddingTop={insets.top + 56}
                                canPlay={
                                    tracks.length > 0 && !playbackCommandPending
                                }
                                isPlaying={isCollectionPlaying}
                                onPlay={play}
                                onShuffle={shuffle}
                                onOpenOptions={() => setOptionsOpen(true)}
                            />
                        </>
                    }
                    footer={
                        summary ? (
                            <Text
                                className="px-6 pb-2 pt-5 text-center text-sm"
                                style={{
                                    color: HERO_FOREGROUND,
                                    opacity: 0.6,
                                }}
                            >
                                {summary}
                            </Text>
                        ) : null
                    }
                />

                {/* Floats over the cover rather than scrolling with it. Top right
                and an X, the same place and the same glyph every detail screen
                in the app closes from. */}
                <FloatingCloseButton label="Close" size={HERO_BUTTON_SIZE} />

                {optionsOpen ? (
                    <CollectionOptionsMenu
                        kind={kind}
                        collectionId={id}
                        tracks={tracks}
                        onClose={() => setOptionsOpen(false)}
                    />
                ) : null}
            </View>
        </ZoomDismissScreen>
    );
}

/**
 * Genre and year, the line Music puts under the artist. Read off a track
 * because the collection itself is only ever fetched as its songs, and every
 * song on an album carries the album's genre and release date.
 */
function collectionMeta(track?: MusicItem) {
    const genre = track?.genres?.[0];
    const year = track?.releaseDate
        ? new Date(track.releaseDate).getFullYear()
        : undefined;
    return [genre, year].filter(Boolean).join(" · ") || undefined;
}

/**
 * Song count and running time, the line Music puts under the last row. Reads
 * whatever durations are there: a song missing one adds nothing to the total
 * rather than voiding it.
 */
function collectionSummary(tracks: MusicItem[]) {
    if (tracks.length === 0) return undefined;

    const songs = `${tracks.length} ${tracks.length === 1 ? "song" : "songs"}`;
    const seconds = tracks.reduce(
        (total, track) => total + (track.songDuration ?? 0),
        0,
    );
    if (seconds <= 0) return songs;

    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${songs}, ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    return rest === 0
        ? `${songs}, ${hourText}`
        : `${songs}, ${hourText} ${rest} ${rest === 1 ? "minute" : "minutes"}`;
}

/**
 * The cover, the name, and the three buttons under it, centered above the
 * track list.
 *
 * `expo-image` rather than the React Native one: it caches to disk and decodes
 * off the JS thread, so a cover already seen in a list is on screen on the
 * first frame instead of a beat later.
 */
function CollectionHero({
    title,
    subtitle,
    meta,
    artworkUrl,
    coverWidth,
    buttonRowWidth,
    paddingTop,
    canPlay,
    isPlaying,
    onPlay,
    onShuffle,
    onOpenOptions,
}: {
    title: string;
    subtitle?: string;
    meta?: string;
    artworkUrl?: string;
    coverWidth: number;
    buttonRowWidth: number;
    paddingTop: number;
    canPlay: boolean;
    isPlaying: boolean;
    onPlay: () => void;
    onShuffle: () => void;
    onOpenOptions: () => void;
}) {
    return (
        <View className="items-center px-6 pb-6" style={{ paddingTop }}>
            {artworkUrl ? (
                <Image
                    source={{ uri: artworkUrl }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    priority="high"
                    transition={200}
                    style={{
                        width: coverWidth,
                        height: coverWidth,
                        borderRadius: 8,
                    }}
                />
            ) : (
                <View
                    className="items-center justify-center rounded-lg bg-muted"
                    style={{ width: coverWidth, height: coverWidth }}
                >
                    <Ionicons name="disc" size={48} color={HERO_FOREGROUND} />
                </View>
            )}

            <Text
                className="pt-5 text-center text-2xl font-bold tracking-tight"
                style={{ color: HERO_FOREGROUND }}
                numberOfLines={2}
            >
                {title}
            </Text>
            {subtitle ? (
                <Text
                    className="pt-1 text-center text-xl"
                    style={{ color: HERO_FOREGROUND, opacity: 0.75 }}
                    numberOfLines={1}
                >
                    {subtitle}
                </Text>
            ) : null}
            {meta ? (
                <Text
                    className="pt-1 text-center text-xs font-semibold uppercase"
                    style={{ color: HERO_FOREGROUND, opacity: 0.6 }}
                    numberOfLines={1}
                >
                    {meta}
                </Text>
            ) : null}

            {/* Music's arrangement: the one thing you came here to press in
                the middle, the two circles that qualify it either side. */}
            <View
                className="flex-row items-center gap-3 pt-5"
                style={{ width: buttonRowWidth }}
            >
                <HeroCircleButton
                    label="Shuffle"
                    icon="shuffle"
                    disabled={!canPlay}
                    onPress={onShuffle}
                />
                <PlayButton
                    disabled={!canPlay}
                    isPlaying={isPlaying}
                    onPress={onPlay}
                />
                <HeroCircleButton
                    label="More options"
                    icon="ellipsis-horizontal"
                    disabled={false}
                    onPress={onOpenOptions}
                />
            </View>
        </View>
    );
}

/**
 * The wide button under the cover. White on whatever the tint is, so it reads
 * the same on a pale cover and a dark one.
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
            accessibilityLabel={isPlaying ? "Pause" : "Play"}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={onPress}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-full bg-white active:opacity-80"
            style={{ height: HERO_BUTTON_SIZE, opacity: disabled ? 0.4 : 1 }}
        >
            <Ionicons
                name={isPlaying ? "pause" : "play"}
                size={20}
                color="#000000"
            />
            <Text
                className="text-lg font-semibold"
                style={{ color: "#000000" }}
            >
                {isPlaying ? "Pause" : "Play"}
            </Text>
        </Pressable>
    );
}

/** One of the two circles either side of Play. */
function HeroCircleButton({
    label,
    icon,
    disabled,
    onPress,
}: {
    label: string;
    icon: ComponentProps<typeof Ionicons>["name"];
    disabled: boolean;
    onPress: () => void;
}) {
    // The glass button owns its own pressed style, so the disabled dimming
    // goes on a wrapper rather than fighting it for the same prop.
    return (
        <View style={{ opacity: disabled ? 0.4 : 1 }}>
            <GlassIconButton
                size={HERO_BUTTON_SIZE}
                accessibilityLabel={label}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={onPress}
            >
                <Ionicons name={icon} size={22} color={HERO_FOREGROUND} />
            </GlassIconButton>
        </View>
    );
}
