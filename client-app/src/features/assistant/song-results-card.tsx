import Ionicons from "@expo/vector-icons/Ionicons";
import { ShuffleMode, type MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { logHandledError } from "@/lib/log";
import { usePagedTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlaybackCommands, usePlaybackTrackState } from "@/lib/playback";
import { useAppTheme } from "@/lib/theme";

import type { AssistantSongs } from "./types";

/** How many songs the card lists. Play still queues every one. */
const SHOWN_SONGS = 5;

/**
 * The songs a tool found, under the answer: the first few rows, how many more,
 * and Play / Shuffle for all of them. Tapping a row plays just that song.
 *
 * Once anything starts playing, the assistant sheet gives way to the now
 * playing sheet, showing the song that started. `replace` rather than `push`,
 * so the player sits straight over the tabs like it does from the mini player,
 * and the conversation is still there when the assistant opens again.
 */
export function SongResultsCard({ songs }: { songs: AssistantSongs }) {
    const { colors } = useAppTheme();
    const { tracks, tracksLoading, resolveTracks } = usePagedTracksForSongIds(
        songs.song_ids,
    );
    const router = useRouter();
    const { playQueue, playNext, skipToNext, setShuffleMode } =
        usePlaybackCommands();
    const { activeTrack } = usePlaybackTrackState();
    // a ref as well as state, so two taps in one frame cannot both start
    const running = useRef(false);
    const [pending, setPending] = useState(false);

    const openNowPlaying = useCallback(() => {
        router.replace("/player");
    }, [router]);

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
            setPending(true);
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
                setPending(false);
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
    const more = songs.total - shown.length;

    /**
     * Plays just the tapped song, queueing none of the card's others. With
     * something already playing it goes in next and is skipped to, so whatever
     * was queued after the old song is still there after this one. With
     * nothing playing it starts a queue of one.
     */
    const playOne = useCallback(
        async (track: MusicItem) => {
            try {
                if (activeTrack) {
                    await playNext([track]);
                    await skipToNext();
                } else {
                    await playQueue({ tracks: [track], chosenStart: true });
                }
            } catch (error) {
                logHandledError("Assistant could not play the song", error);
                return;
            }
            openNowPlaying();
        },
        [activeTrack, openNowPlaying, playNext, playQueue, skipToNext],
    );

    if (!tracksLoading && shown.length === 0) return null;

    return (
        <View className="mt-2 overflow-hidden rounded-2xl border border-border bg-card">
            {tracksLoading
                ? Array.from({
                      length: Math.min(3, songs.song_ids.length),
                  }).map((_, index) => <SongRowSkeleton key={index} />)
                : shown.map((track, index) => (
                      <Pressable
                          key={track.id}
                          onPress={() => void playOne(track)}
                          accessibilityRole="button"
                          accessibilityLabel={`Play ${track.title}`}
                          className={
                              index > 0
                                  ? "flex-row items-center gap-3 border-t border-border px-3 py-2 active:opacity-60"
                                  : "flex-row items-center gap-3 px-3 py-2 active:opacity-60"
                          }
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
                                  borderRadius: 6,
                                  backgroundColor: colors.muted,
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

            <View className="flex-row items-center gap-2 border-t border-border px-3 py-2">
                <Text className="flex-1 text-[13px] text-muted-foreground">
                    {more > 0
                        ? `${more.toLocaleString()}${songs.capped ? "+" : ""} more`
                        : `${songs.total.toLocaleString()} ${songs.total === 1 ? "song" : "songs"}`}
                </Text>
                {pending ? (
                    <ActivityIndicator
                        size="small"
                        color={colors.mutedForeground}
                    />
                ) : null}
                <CardButton
                    icon="play"
                    label="Play"
                    onPress={() => void playAll(false)}
                />
                <CardButton
                    icon="shuffle"
                    label="Shuffle"
                    onPress={() => void playAll(true)}
                />
            </View>
        </View>
    );
}

function CardButton({
    icon,
    label,
    onPress,
}: {
    icon: "play" | "shuffle";
    label: string;
    onPress: () => void;
}) {
    const { colors } = useAppTheme();
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            className="flex-row items-center gap-1 rounded-full bg-muted px-3 py-1.5 active:opacity-60"
        >
            <Ionicons name={icon} size={14} color={colors.foreground} />
            <Text className="text-[13px] font-medium">{label}</Text>
        </Pressable>
    );
}

function SongRowSkeleton() {
    return (
        <View className="flex-row items-center gap-3 px-3 py-2">
            <View className="h-10 w-10 rounded-md bg-muted" />
            <View className="flex-1 gap-1.5">
                <View className="h-3 w-2/3 rounded bg-muted" />
                <View className="h-3 w-1/3 rounded bg-muted" />
            </View>
        </View>
    );
}

/** A shuffled copy of `items` (Fisher-Yates). */
function shuffledCopy<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
