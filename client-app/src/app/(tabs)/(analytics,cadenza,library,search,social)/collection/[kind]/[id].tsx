import {
    collectionSummary,
    collectionHeaderMetadata,
} from "@/components/custom/track-collection-utils";
import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useTheme } from "expo-router/react-navigation";

import { CollectionOptionsMenu } from "@/components/custom/options-menu/collection-options-menu";
import { TrackCollectionView } from "@/components/custom/track-collection-view";
import {
    FloatingBackButton,
    HERO_BUTTON_SIZE,
} from "@/components/ui/floating-back-button";
import { useArrangedTrackList } from "@/lib/arranged-track-list";
import { Text } from "@/components/ui/text";
import { useArtworkTint } from "@/lib/artwork-color";
import {
    indexTracksById,
    useCollectionInfo,
    useCollectionSongsOrFallback,
} from "@/lib/musickit-hooks";
import { isTrackInCollection } from "@/lib/playable-item";
import type { PlaySource } from "@/lib/play-source";
import { usePlayFromList } from "@/lib/play-from-list";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import type { ArrangeSource } from "@/lib/routes/arrange";
import {
    isArranged,
    NO_ARRANGEMENT,
    type SongArrangement,
} from "@/lib/song-arrangement";

import type { LibraryCollectionKind } from "@/lib/musickit-hooks";

const DEFAULT_MULTI_SELECT_CONFIG = {} as const;
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
        id: routeId,
        fallbackId,
        title,
        artistName,
        artworkColor,
        artworkUrl,
        artworkUrlLarge,
        highlight,
    } = useLocalSearchParams<{
        kind: LibraryCollectionKind;
        id: string;
        title?: string;
        artistName?: string;
        artworkColor?: string;
        artworkUrl?: string;
        artworkUrlLarge?: string;
        highlight?: string;
        fallbackId?: string;
    }>();
    const { activeTrack, isPlaying } = usePlaybackTrackState();
    const { playQueue, setShuffleMode, togglePlayback } = usePlaybackCommands();
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [playbackCommandPending, setPlaybackCommandPending] = useState(false);
    // a full album that will not load falls back to the library copy
    const {
        collectionId: id = routeId,
        tracks,
        tracksLoading,
        tracksLoadingNextPage,
        loadNextCollectionPage,
        hasNextCollectionPage,
        tracksErr,
    } = useCollectionSongsOrFallback(kind, routeId, fallbackId);
    const firstTrack = tracks[0];
    const { collection } = useCollectionInfo(
        kind,
        kind === "playlist" && !artistName ? id : undefined,
    );

    const headerMetadata = collectionHeaderMetadata(
        kind,
        artistName,
        collection,
        firstTrack,
    );

    // sorted or grouped, the backend orders the whole collection, so every page
    // has to be in before it can be asked. the pages load either way
    // starts unsorted every time the screen opens, and is never saved
    const [arrangement, setArrangement] =
        useState<SongArrangement>(NO_ARRANGEMENT);
    const arranged = isArranged(arrangement);
    const everyPageIn =
        !tracksLoading && !hasNextCollectionPage && !tracksLoadingNextPage;
    const source = useMemo<ArrangeSource | null>(
        () =>
            arranged && everyPageIn
                ? {
                      kind: "songs",
                      // the id tags and metadata are kept under
                      songIds: tracks.map(
                          (track) => track.catalogId ?? track.id,
                      ),
                  }
                : null,
        [arranged, everyPageIn, tracks],
    );
    // every song is already here, so nothing needs Apple to find it
    const lookupTracks = useCallback(
        async () => indexTracksById(tracks),
        [tracks],
    );
    const resetArrangement = useCallback(
        () => setArrangement(NO_ARRANGEMENT),
        [setArrangement],
    );
    const list = useArrangedTrackList({
        source,
        arrangement,
        lookupTracks,
        localTracks: tracks,
        onRejected: resetArrangement,
    });
    const waitingToSort = arranged && (!everyPageIn || list.loading);
    // what plays, and what the hero counts: every song, in the list's order
    const orderedTracks =
        arranged && list.active ? list.allLocalTracks : tracks;
    // a playlist is somewhere a play can come from, so its plays are credited
    // to it. an album already ranks off the track itself
    const playSource = useMemo<PlaySource | undefined>(
        () =>
            kind === "playlist"
                ? { kind: "playlist", id, name: title ?? "Playlist" }
                : undefined,
        [id, kind, title],
    );
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
    // Only once every page is in. A count off a half-loaded list is a wrong
    // number, which is worse than no number.
    const summary = everyPageIn ? collectionSummary(tracks) : undefined;

    /** Plays the collection from the top, replacing the queue. */
    async function play() {
        if (orderedTracks.length === 0 || playbackCommandPending) return;
        setPlaybackCommandPending(true);
        try {
            if (isCurrentCollection && activeTrack) {
                await togglePlayback(activeTrack);
                return;
            }
            await setShuffleMode(ShuffleMode.Off);
            await playQueue({ tracks: orderedTracks, source: playSource });
        } finally {
            setPlaybackCommandPending(false);
        }
    }

    /** The same queue, shuffled, starting somewhere other than the first song. */
    async function shuffle() {
        if (orderedTracks.length === 0 || playbackCommandPending) return;
        setPlaybackCommandPending(true);
        try {
            await setShuffleMode(ShuffleMode.Songs);
            await playQueue({
                tracks: orderedTracks,
                startIndex: Math.floor(Math.random() * orderedTracks.length),
                source: playSource,
            });
        } finally {
            setPlaybackCommandPending(false);
        }
    }

    /** A row plays the collection from that song, credited to it. */
    const playFromList = usePlayFromList();
    const playRow = useCallback(
        (track: MusicItem) => playFromList(orderedTracks, track, playSource),
        [orderedTracks, playFromList, playSource],
    );

    return (
        <View className="flex-1">
            <TrackCollectionView
                title={title ?? (kind === "playlist" ? "Playlist" : "Album")}
                tracks={orderedTracks}
                isLoading={tracksLoading}
                highlightTrackId={highlight}
                error={tracksErr ?? list.error}
                pagination={{
                    hasNextPage: hasNextCollectionPage,
                    isLoadingNextPage: tracksLoadingNextPage,
                    onLoadNextPage: loadNextCollectionPage,
                }}
                loadAllPages
                sections={arranged ? list.sections : null}
                arrangement={{
                    value: arrangement,
                    onChange: setArrangement,
                    sortValues: list.sortValues,
                }}
                listOverlay={
                    waitingToSort ? (
                        <WaitingToSort loadedCount={tracks.length} />
                    ) : null
                }
                multiSelect={DEFAULT_MULTI_SELECT_CONFIG}
                subtitle={headerMetadata.subtitle}
                subtitleClassName={
                    kind === "album" ? "text-xl text-foreground" : "text-lg"
                }
                summary={headerMetadata.summary ?? ""}
                trackSummary={summary}
                backgroundColor={tint}
                artworkUrls={[
                    artworkUrlLarge ??
                        firstTrack?.artworkUrlLarge ??
                        artworkUrl ??
                        firstTrack?.artworkUrl ??
                        "",
                ].filter(Boolean)}
                artworkPlaceholderUrl={artworkUrl ?? firstTrack?.artworkUrl}
                isPlaying={isCollectionPlaying}
                respectTopSafeArea
                onPlay={play}
                onShuffle={shuffle}
                onTrackPressOverride={playRow}
                options={[
                    {
                        id: "collection-options",
                        label: "More options",
                        icon: "ellipsis-horizontal",
                        onPress: () => setOptionsOpen(true),
                    },
                ]}
                backControl={<FloatingBackButton size={HERO_BUTTON_SIZE} />}
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
    );
}

/**
 * Shown in place of the songs while a sorted collection waits for its last
 * pages, then for the backend to sort it. A long playlist takes a few seconds.
 */
function WaitingToSort({ loadedCount }: { loadedCount: number }) {
    const { colors } = useTheme();
    return (
        <View
            className="items-center gap-3 px-6 py-12"
            accessibilityRole="progressbar"
            accessibilityLabel="Loading every song so the list can be sorted"
        >
            <ActivityIndicator size="large" color={colors.text} />
            <Text className="text-center text-base font-semibold">
                Sorting every song
            </Text>
            <Text className="text-center text-sm text-muted-foreground">
                {loadedCount > 0
                    ? `${loadedCount} ${loadedCount === 1 ? "song" : "songs"} loaded so far`
                    : "Loading songs"}
            </Text>
        </View>
    );
}
