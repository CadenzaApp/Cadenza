import Ionicons from "@expo/vector-icons/Ionicons";
import type { MusicItem } from "@apple-musickit";
import { Image } from "expo-image";
import { useCallback } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import { usePagedTracksForSongIds } from "@/lib/musickit-hooks";
import { usePlayAll } from "@/lib/play-all";
import { usePlaybackCommands } from "@/lib/playback";
import { useAppTheme } from "@/lib/theme";

import type { AssistantSongs } from "./types";

/** How many songs the card lists. Play still queues every one. */
const SHOWN_SONGS = 5;

/**
 * The songs a tool found, under the answer: the first few rows, how many more,
 * and Play / Shuffle for all of them. Tapping a row plays the list from it.
 */
export function SongResultsCard({ songs }: { songs: AssistantSongs }) {
    const { colors } = useAppTheme();
    const { tracks, tracksLoading, resolveTracks } = usePagedTracksForSongIds(
        songs.song_ids,
    );
    const { playQueue } = usePlaybackCommands();
    const resolveQueue = useCallback(
        () => resolveTracks(songs.song_ids),
        [resolveTracks, songs.song_ids],
    );
    const { play, shuffle, pending } = usePlayAll({ resolveQueue });

    const shown = tracks.slice(0, SHOWN_SONGS);
    const more = songs.total - shown.length;

    const playFrom = useCallback(
        (track: MusicItem) => {
            const startIndex = tracks.findIndex((item) => item.id === track.id);
            void playQueue({
                tracks,
                startIndex: Math.max(startIndex, 0),
                chosenStart: true,
            });
        },
        [playQueue, tracks],
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
                          onPress={() => playFrom(track)}
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
                <CardButton icon="play" label="Play" onPress={play} />
                <CardButton icon="shuffle" label="Shuffle" onPress={shuffle} />
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
