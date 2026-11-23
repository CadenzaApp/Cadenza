import Ionicons from "@expo/vector-icons/Ionicons";
import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { ArtworkMosaic } from "@/components/custom/artwork-mosaic";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Text } from "@/components/ui/text";
import { logHandledError } from "@/lib/log";
import { useOpenScreen } from "@/lib/open-screen";
import { usePagedTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlaybackCommands } from "@/lib/playback";
import { useAppTheme } from "@/lib/theme";

import { CardButton, Hairline, withAlpha } from "./assistant-ui";
import { currentPlayback } from "./playback-snapshot";
import { shuffledCopy } from "./phone-tools";
import { useQueryHandoff } from "./use-query-handoff";
import type { AssistantSongs } from "./types";

/** How many songs the card lists. Play still queues every one. */
const SHOWN_SONGS = 5;

/** How many covers the mosaic at the top of the card shows. */
const MOSAIC_COVERS = 4;

/**
 * The songs a tool found, under the answer, on glass: a mosaic of the first
 * covers beside the total, Play and Shuffle for all of them, the first few
 * rows, and a button for the rest. Tapping a row plays just that
 * song. The button at the bottom closes the assistant. A card from `run_query` loads
 * its query into the Cadenza builder and opens its results there (see
 * `useQueryHandoff`); any other card shows every song it holds on the song
 * list screen, titled with the card's name. Either way they can be sorted,
 * selected and tagged.
 *
 * Once anything starts playing, the assistant sheet gives way to the now
 * playing sheet, showing the song that started. `replace` rather than `push`,
 * so the player sits straight over the tabs like it does from the mini player,
 * and the conversation is still there when the assistant opens again.
 */
export function SongResultsCard({ songs }: { songs: AssistantSongs }) {
    const { colors } = useAppTheme();
    const {
        tracks,
        loadedCount,
        tracksLoading,
        isLoadingNextPage,
        resolveTracks,
    } = usePagedTracksForSongIds(songs.song_ids);
    const router = useRouter();
    const openScreen = useOpenScreen();
    const { playQueue, setShuffleMode } = usePlaybackCommands();
    // a ref as well as state, so two taps in one frame cannot both start
    const running = useRef(false);
    // which of Play or Shuffle is starting, for its spinner
    const [pending, setPending] = useState<"play" | "shuffle" | null>(null);

    const openNowPlaying = useCallback(() => {
        router.replace("/player");
    }, [router]);

    const handOff = useQueryHandoff();

    const openList = useCallback(async () => {
        if (songs.query) {
            try {
                if (await handOff(songs.query)) return;
            } catch (error) {
                logHandledError(
                    "Assistant could not open the query in the builder",
                    error,
                );
            }
        }
        openScreen(
            {
                pathname: "/song-list",
                params: {
                    ids: songs.song_ids.join(","),
                    total: String(songs.total),
                    capped: songs.capped ? "1" : "0",
                    ...(songs.title ? { title: songs.title } : {}),
                },
            } as Href,
            { closing: "assistant" },
        );
    }, [handOff, openScreen, songs]);

    /**
     * Plays every song on the card, in order or shuffled, then opens the now
     * playing sheet.
     *
     * Shuffle shuffles the songs here and starts at the first, with Apple's
     * shuffle off. Turning Apple's shuffle on and starting at a random song
     * (what `usePlayAll` does) leaves the queue in list order, so Up Next only
     * showed the songs after wherever it happened to start, sometimes one.
     */
    const playAll = useCallback(
        async (shuffled: boolean) => {
            if (running.current) return;
            running.current = true;
            setPending(shuffled ? "shuffle" : "play");
            try {
                const resolved = await resolveTracks(songs.song_ids);
                if (resolved.length === 0) return;
                await setShuffleMode(ShuffleMode.Off);
                await playQueue({
                    tracks: shuffled ? shuffledCopy(resolved) : resolved,
                    startIndex: 0,
                });
                openNowPlaying();
            } catch (error) {
                logHandledError("Assistant could not play the songs", error);
            } finally {
                running.current = false;
                setPending(null);
            }
        },
        [
            openNowPlaying,
            playQueue,
            resolveTracks,
            setShuffleMode,
            songs.song_ids,
        ],
    );

    const shown = tracks.slice(0, SHOWN_SONGS);
    // Songs resolve a few at a time (the library first, then Apple Music), and
    // the list only grows while lookups run. Until the first rows have all
    // resolved, the rest hold placeholders, so the card appears at its full
    // size and fills in rather than growing from one row to five.
    const expectedRows = Math.min(SHOWN_SONGS, songs.song_ids.length);
    const stillLoading =
        tracksLoading || (isLoadingNextPage && shown.length < expectedRows);
    const placeholderRows = stillLoading ? expectedRows - shown.length : 0;
    // ids Apple could not turn into a track are dropped, not counted as more
    const skipped = loadedCount - tracks.length;
    const available = songs.total - skipped;

    /**
     * Plays the tapped song now, queueing none of the card's others. The song
     * that was playing goes to the top of Up Next, ahead of whatever was
     * queued after it, so it comes back once this one ends. Tapping the song
     * already playing just opens the player.
     */
    const playOne = useCallback(
        async (track: MusicItem) => {
            const playback = currentPlayback();
            const current = playback?.activeTrack ?? null;
            try {
                if (current?.id !== track.id) {
                    // one new queue, so the tapped song is what plays when the
                    // player opens: it, then the song that was playing, then
                    // everything that was queued after that
                    await playQueue({
                        tracks: current
                            ? [track, current, ...(playback?.upcoming ?? [])]
                            : [track],
                        startIndex: 0,
                        chosenStart: true,
                    });
                }
            } catch (error) {
                logHandledError("Assistant could not play the song", error);
                return;
            }
            openNowPlaying();
        },
        [openNowPlaying, playQueue],
    );

    if (!stillLoading && shown.length === 0) return null;

    const countLabel = `${available.toLocaleString()}${songs.capped ? "+" : ""} ${available === 1 && !songs.capped ? "song" : "songs"}`;
    // the rows still to come count as shown, so the button does not shrink
    // its number as they fill in
    const more = available - (stillLoading ? expectedRows : shown.length);
    const moreLabel =
        more > 0
            ? `${more.toLocaleString()}${songs.capped ? "+" : ""} more`
            : "Open list";
    const covers = shown
        .map((track) => track.artworkUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, MOSAIC_COVERS);
    const rowFill = withAlpha(colors.foreground, 0.08);

    return (
        <GlassPanel>
            <View className="flex-row items-center gap-3 px-3.5 pb-3 pt-3.5">
                <ArtworkMosaic
                    artworkUrls={covers}
                    size={56}
                    placeholderColor={colors.mutedForeground}
                    className="rounded-xl"
                />
                <View className="min-w-0 flex-1">
                    <Text
                        className="text-[17px] font-semibold tracking-tight"
                        numberOfLines={1}
                    >
                        {countLabel}
                    </Text>
                    {songs.title ? (
                        <Text
                            className="text-[13px] text-muted-foreground"
                            numberOfLines={1}
                        >
                            {songs.title}
                        </Text>
                    ) : null}
                </View>
            </View>
            <View className="flex-row gap-2 px-3.5 pb-3.5">
                <CardButton
                    grow
                    tone="brand"
                    icon="play"
                    label="Play"
                    loading={pending === "play"}
                    disabled={pending !== null}
                    onPress={() => void playAll(false)}
                />
                <CardButton
                    grow
                    icon="shuffle"
                    label="Shuffle"
                    loading={pending === "shuffle"}
                    disabled={pending !== null}
                    onPress={() => void playAll(true)}
                />
            </View>
            <Hairline className="mx-3.5" />

            <View className="py-1">
                {shown.map((track) => (
                    <Pressable
                        key={track.id}
                        onPress={() => void playOne(track)}
                        accessibilityRole="button"
                        accessibilityLabel={`Play ${track.title}`}
                        className="flex-row items-center gap-3 px-3.5 py-2 active:opacity-60"
                    >
                        <Image
                            source={
                                track.artworkUrl
                                    ? { uri: track.artworkUrl }
                                    : undefined
                            }
                            style={{
                                width: 40,
                                height: 40,
                                borderRadius: 8,
                                backgroundColor: rowFill,
                            }}
                        />
                        <View className="flex-1">
                            <Text className="text-[15px]" numberOfLines={1}>
                                {track.title}
                            </Text>
                            {track.artistName ? (
                                <Text
                                    className="text-[13px] text-muted-foreground"
                                    numberOfLines={1}
                                >
                                    {track.artistName}
                                </Text>
                            ) : null}
                        </View>
                    </Pressable>
                ))}
                {Array.from({ length: placeholderRows }).map((_, index) => (
                    <SongRowSkeleton
                        key={`placeholder-${index}`}
                        fill={rowFill}
                    />
                ))}
            </View>

            <Hairline />
            <Pressable
                onPress={() => void openList()}
                accessibilityRole="button"
                accessibilityLabel={`Open the list of ${countLabel}`}
                className="h-11 flex-row items-center justify-center gap-1 active:opacity-60"
            >
                <Text className="text-[14px] font-medium">{moreLabel}</Text>
                <Ionicons
                    name="chevron-forward"
                    size={14}
                    color={colors.foreground}
                />
            </Pressable>
        </GlassPanel>
    );
}

/** A row still loading: a cover and two lines in a faint wash. */
function SongRowSkeleton({ fill }: { fill: string }) {
    return (
        <View className="flex-row items-center gap-3 px-3.5 py-2">
            <View
                className="h-10 w-10 rounded-lg"
                style={{ backgroundColor: fill }}
            />
            <View className="flex-1 gap-1.5">
                <View
                    className="h-3 w-2/3 rounded"
                    style={{ backgroundColor: fill }}
                />
                <View
                    className="h-3 w-1/3 rounded"
                    style={{ backgroundColor: fill }}
                />
            </View>
        </View>
    );
}
