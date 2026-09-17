import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useWindowDimensions, View } from "react-native";

import { CollectionOptionsMenu } from "@/components/custom/options-menu/collection-options-menu";
import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { Text } from "@/components/ui/text";
import {
    TintBackdrop,
    TintOverscrollBackdrop,
} from "@/components/ui/tint-backdrop";
import { useArtworkTint } from "@/lib/artwork-color";
import { useCollectionSongs } from "@/lib/musickit-hooks";
import { isTrackInCollection } from "@/lib/playable-item";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { ZoomDismissScreen } from "@/lib/zoom-dismiss";

import type { LibraryCollectionKind } from "@/lib/musickit-hooks";

const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
/** Diameter of the floating close button. */
const HERO_BUTTON_SIZE = 52;
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
 * `TrackCollectionView` owns the `MusicList` scroll surface and its standard
 * cover, metadata, and action header. This route supplies Apple Music paging,
 * playback state, artwork tint, zoom dismissal, and the rich options menu.
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
    const { height: windowHeight } = useWindowDimensions();
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
            <View className="flex-1">
                <TrackCollectionView
                    title={
                        title ?? (kind === "playlist" ? "Playlist" : "Album")
                    }
                    tracks={tracks}
                    isLoading={tracksLoading}
                    error={tracksErr}
                    pagination={{
                        hasNextPage: hasNextCollectionPage,
                        isLoadingNextPage: tracksLoadingNextPage,
                        onLoadNextPage: loadNextCollectionPage,
                    }}
                    sorting={null}
                    multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                    subtitle={artistName ?? firstTrack?.artistName}
                    summary={collectionMeta(firstTrack)}
                    artworkUrls={[
                        artworkUrlLarge ??
                            firstTrack?.artworkUrlLarge ??
                            artworkUrl ??
                            firstTrack?.artworkUrl ??
                            "",
                    ].filter(Boolean)}
                    isPlaying={isCollectionPlaying}
                    respectTopSafeArea
                    onPlay={play}
                    onShuffle={shuffle}
                    options={[
                        {
                            id: "collection-options",
                            label: "More options",
                            icon: "ellipsis-horizontal",
                            onPress: () => setOptionsOpen(true),
                        },
                    ]}
                    closeControl={
                        <FloatingCloseButton
                            label="Close"
                            size={HERO_BUTTON_SIZE}
                        />
                    }
                    overscrollBackground={
                        <TintOverscrollBackdrop
                            tint={tint}
                            depth={TINT_DEPTH}
                        />
                    }
                    background={
                        <TintBackdrop
                            tint={tint}
                            height={contentHeight}
                            depth={TINT_DEPTH}
                        />
                    }
                    onContentSizeChange={(_, height) =>
                        setContentHeight(Math.max(windowHeight, height))
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
