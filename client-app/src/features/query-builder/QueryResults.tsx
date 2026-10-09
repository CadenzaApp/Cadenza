import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { useCallback, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";

import type {
    MusicListPagination,
    MusicListSort,
} from "@/components/custom/music-list";
import { TrackCollectionView } from "@/components/custom/track-collection-view";
import { useCollectionArtworkTint } from "@/components/custom/use-collection-artwork-tint";
import { ModalPopup } from "@/components/custom/modal-popup";
import { FloatingCloseButton } from "@/components/ui/floating-close-button";
import { GlassButton } from "@/components/ui/glass-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useListeningEvents } from "@/lib/listening-events";
import type { PlaySource } from "@/lib/play-source";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";

import { matchCountLabel } from "./QueryUtils";

const HERO_BUTTON_SIZE = 52;
/** The sorts the backend can apply to a whole result. */
const SORT_OPTIONS = ["title", "artist", "album"] as const;

type Props = {
    /** The tracks loaded so far, in order. More arrive through `pagination`. */
    songs: MusicItem[];
    isLoading: boolean;
    error?: unknown;
    /** Every song the query matched, loaded or not. */
    matchCount: number;
    /** More songs from outside the user's own matched than came back. */
    capped: boolean;
    pagination: MusicListPagination;
    sort: MusicListSort;
    /** The backend sorts, so a new sort is a new result. */
    onSortChange: (sort: MusicListSort) => void;
    /**
     * The tracks Play and Shuffle queue: every song that is certainly the
     * user's own, including ones the list has not reached, and the others
     * already loaded.
     */
    resolvePlayQueue: () => Promise<MusicItem[]>;
    mostRelevantTags?: readonly string[];
    /** The activity tags the query filters on, shown on every row. */
    activityTagIds?: readonly number[];
    /** What a play from here is credited to in the analytics rankings. */
    playSource?: PlaySource;
};

export default function QueryResults({
    songs,
    isLoading,
    error,
    matchCount,
    capped,
    pagination,
    sort,
    onSortChange,
    resolvePlayQueue,
    mostRelevantTags,
    activityTagIds,
    playSource,
}: Props) {
    const { width: screenWidth } = useWindowDimensions();
    const [saveOpen, setSaveOpen] = useState(false);
    const [saveName, setSaveName] = useState("");
    // a ref rather than state, so two taps in one frame cannot both start
    const playbackCommandPending = useRef(false);
    const { tint, artworkUrls } = useCollectionArtworkTint(songs);
    const { recordEvent } = useListeningEvents();
    const { playQueue, setShuffleMode, togglePlayback } = usePlaybackCommands();
    const { activeTrackId, isPlaying } = usePlaybackTrackState();
    const saveDialogWidth = Math.round(screenWidth * 0.75);
    const allLoaded =
        !isLoading &&
        !pagination.hasNextPage &&
        !pagination.isLoadingNextPage &&
        songs.length > 0;

    /**
     * Notes that a song was played out of this query, which is what the query
     * play rate is built from. Only the song that starts playing is recorded,
     * so the rate counts starts. Every counted play in the queue is credited to
     * the query separately, through `playSource`, for the query ranking.
     */
    const recordQueryPlay = useCallback(
        (track: MusicItem) => {
            // the id tags cross the api under, the same key the rest of the app
            // reads a song's tags with
            const songId = track.catalogId ?? track.id;
            void recordEvent("query_play", songId, {
                result_count: matchCount,
            }).catch(() => {
                // a lost event is not worth interrupting playback over
            });
        },
        [matchCount, recordEvent],
    );

    /**
     * Plays the query's queue from the top, or shuffled from somewhere in it.
     * The queue can reach past the loaded rows, so it is resolved first, and a
     * second tap while that runs is ignored.
     */
    const playResults = useCallback(
        async (shuffle: boolean) => {
            if (playbackCommandPending.current) return;
            playbackCommandPending.current = true;
            try {
                const tracks = await resolvePlayQueue();
                if (tracks.length === 0) return;
                const startIndex = shuffle
                    ? Math.floor(Math.random() * tracks.length)
                    : 0;
                recordQueryPlay(tracks[startIndex]);
                await setShuffleMode(
                    shuffle ? ShuffleMode.Songs : ShuffleMode.Off,
                );
                await playQueue({ tracks, startIndex, source: playSource });
            } finally {
                playbackCommandPending.current = false;
            }
        },
        [
            playQueue,
            playSource,
            recordQueryPlay,
            resolvePlayQueue,
            setShuffleMode,
        ],
    );
    const playFromTop = useCallback(() => playResults(false), [playResults]);
    const shuffleAll = useCallback(() => playResults(true), [playResults]);

    const playOneSong = useCallback(
        async (track: MusicItem) => {
            // togglePlayback pauses when the row is already the active track, so
            // recording unconditionally would count a pause as a play
            const isPausing = activeTrackId === track.id && isPlaying;
            if (!isPausing) recordQueryPlay(track);
            await togglePlayback(track, playSource);
        },
        [activeTrackId, isPlaying, playSource, recordQueryPlay, togglePlayback],
    );
    function closeSaveDialog() {
        setSaveOpen(false);
        setSaveName("");
    }

    function submitSave() {
        const name = saveName.trim();
        if (!name) return;
        console.info(
            `[QueryResults] Saving query "${name}" is not implemented yet.`,
        );
        closeSaveDialog();
    }

    return (
        <View className="flex-1">
            <TrackCollectionView
                title="Matching Songs"
                tracks={songs}
                isLoading={isLoading}
                error={error}
                anticipatedTrackCount={matchCount}
                summary={matchCountLabel(matchCount, capped)}
                pagination={pagination}
                sorting={{
                    options: SORT_OPTIONS,
                    value: sort,
                    strategy: "remote",
                    onChange: onSortChange,
                }}
                footer={
                    allLoaded ? (
                        <Text className="px-6 py-4 text-center text-sm text-muted-foreground">
                            {capped
                                ? "These are your matching songs and the first 1,000 others Cadenza knows. Narrow the query to see more."
                                : "These are all the songs Cadenza knows that match."}
                        </Text>
                    ) : null
                }
                respectTopSafeArea
                closeControl={
                    <FloatingCloseButton
                        label="Close query results"
                        size={HERO_BUTTON_SIZE}
                    />
                }
                multiSelect={{}}
                showTags
                mostRelevantTags={mostRelevantTags}
                activityTagIds={activityTagIds}
                backgroundColor={tint}
                artworkUrls={artworkUrls}
                onPlay={playFromTop}
                onShuffle={shuffleAll}
                onTrackPressOverride={playOneSong}
                options={[
                    {
                        id: "save-query",
                        label: "Save query",
                        icon: "bookmark-outline",
                        onPress: () => setSaveOpen(true),
                    },
                ]}
            />

            <ModalPopup
                visible={saveOpen}
                onClose={closeSaveDialog}
                title="Save Query"
                contentStyle={{
                    width: saveDialogWidth,
                    minWidth: saveDialogWidth,
                    maxWidth: saveDialogWidth,
                    transform: [{ translateY: -96 }],
                }}
            >
                <Text className="text-sm text-muted-foreground">
                    Give this query a name.
                </Text>
                <View className="gap-1.5">
                    <Label>Query name</Label>
                    <Input
                        value={saveName}
                        onChangeText={setSaveName}
                        placeholder="e.g. Late night favorites"
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={submitSave}
                    />
                </View>
                <View className="mt-1 flex-row gap-2.5">
                    <View className="flex-1">
                        <GlassButton
                            className="w-full"
                            onPress={closeSaveDialog}
                        >
                            <Text>Cancel</Text>
                        </GlassButton>
                    </View>
                    <View className="flex-1">
                        <GlassButton
                            className="w-full"
                            disabled={!saveName.trim()}
                            onPress={submitSave}
                        >
                            <Text>Save</Text>
                        </GlassButton>
                    </View>
                </View>
            </ModalPopup>
        </View>
    );
}
