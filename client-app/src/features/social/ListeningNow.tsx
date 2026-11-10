import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { Text } from "@/components/ui/text";
import { useSongInfo } from "@/lib/musickit-hooks";
import {
    useFriendsListening,
    useUserListening,
    type NowPlaying,
    type RecentPlay,
    type UpNextSong,
} from "@/lib/routes/listening";
import { useAppTheme } from "@/lib/theme";
import { isUsableArtworkUrl } from "@/lib/utils";

import { formatRelativeTime, initialsFromUsername } from "./format";
import { formatTrackTime, livePositionMs } from "./listening-progress";

/** Recent plays a profile shows. */
const PROFILE_RECENT_PLAYS = 10;

/** How wide one card is in the feed's row, so the next one peeks in. */
const STRIP_CARD_WIDTH = 300;

/** Artwork size on a card. The progress and up next sit beside it. */
const CARD_ARTWORK_SIZE = 104;

/**
 * Friends playing something now, a row of cards across the top of the feed.
 * Tapping one opens their profile. Draws nothing while no friend is playing.
 */
export function ListeningNowStrip() {
    const router = useRouter();
    const { friendsListening } = useFriendsListening();
    if (!friendsListening?.length) return null;

    return (
        <View className="mb-4 gap-2">
            <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Listening now
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-3"
            >
                {friendsListening.map((friend) => (
                    <Pressable
                        key={friend.user_id}
                        accessibilityRole="button"
                        accessibilityLabel={`${friend.username} is playing ${friend.now_playing.title}`}
                        onPress={() =>
                            router.push(`/social/user/${friend.user_id}`)
                        }
                        className="active:opacity-60"
                        style={{ width: STRIP_CARD_WIDTH }}
                    >
                        <ListeningCard
                            nowPlaying={friend.now_playing}
                            username={friend.username}
                        />
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
}

/**
 * What one user is playing now and their recent plays, each as their privacy
 * settings allow. A hidden or empty part is left out, so a private profile
 * draws nothing here.
 */
export function ProfileListening({ userId }: { userId: string }) {
    const { userListening } = useUserListening(userId);
    const nowPlaying = userListening?.now_playing ?? null;
    const recentPlays = userListening?.recent_plays ?? null;
    if (!nowPlaying && !recentPlays?.length) return null;

    return (
        <View className="mb-4 gap-4 border-b border-border pb-5">
            {nowPlaying ? <ListeningCard nowPlaying={nowPlaying} /> : null}
            {recentPlays?.length ? (
                <RecentPlays
                    plays={recentPlays.slice(0, PROFILE_RECENT_PLAYS)}
                />
            ) : null}
        </View>
    );
}

/**
 * One person's listening: who (when `username` is given, else a Playing now
 * label, for their own profile), the song, then the artwork with live
 * progress and up to two up next songs beside it.
 */
function ListeningCard({
    nowPlaying,
    username,
}: {
    nowPlaying: NowPlaying;
    username?: string;
}) {
    const { primary } = useAppTheme().colors;

    return (
        <View className="gap-3 rounded-3xl border border-border p-4">
            {username ? (
                <View className="flex-row items-center gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
                        <Text className="text-xs font-semibold text-foreground">
                            {initialsFromUsername(username)}
                        </Text>
                    </View>
                    <Text
                        className="min-w-0 flex-1 font-semibold text-foreground"
                        numberOfLines={1}
                    >
                        {username}
                    </Text>
                </View>
            ) : (
                <View className="flex-row items-center gap-1">
                    <Ionicons name="musical-note" size={12} color={primary} />
                    <Text className="text-xs font-semibold uppercase tracking-wider text-primary">
                        Playing now
                    </Text>
                </View>
            )}

            <View>
                <Text
                    className="text-lg font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {nowPlaying.title}
                </Text>
                {nowPlaying.artist ? (
                    <Text
                        className="text-sm text-muted-foreground"
                        numberOfLines={1}
                    >
                        {nowPlaying.artist}
                    </Text>
                ) : null}
            </View>

            <View className="flex-row gap-3">
                <Artwork
                    url={nowPlaying.artwork_url}
                    size={CARD_ARTWORK_SIZE}
                />
                <View className="min-w-0 flex-1 gap-3">
                    <LiveProgress nowPlaying={nowPlaying} />
                    <UpNext songs={nowPlaying.up_next} />
                </View>
            </View>
        </View>
    );
}

/** A bar and `m:ss` times, ticking once a second. */
function LiveProgress({ nowPlaying }: { nowPlaying: NowPlaying }) {
    const { position_ms, as_of, duration_ms } = nowPlaying;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const position = livePositionMs(position_ms, as_of, duration_ms, now);
    const fraction = duration_ms ? Math.min(1, position / duration_ms) : 0;

    return (
        <View className="gap-1">
            <View className="h-1 overflow-hidden rounded-full bg-muted">
                <View
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${fraction * 100}%` }}
                />
            </View>
            <View className="flex-row justify-between">
                <Text className="text-xs text-muted-foreground">
                    {formatTrackTime(position)}
                </Text>
                {duration_ms ? (
                    <Text className="text-xs text-muted-foreground">
                        {formatTrackTime(duration_ms)}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

/** The next songs in their queue. Nothing when there are none. */
function UpNext({ songs }: { songs: UpNextSong[] }) {
    if (songs.length === 0) return null;
    return (
        <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Up next
            </Text>
            {songs.map((song, index) => (
                <View
                    key={`${song.song_id ?? song.title}-${index}`}
                    className="flex-row items-center gap-2"
                >
                    <Artwork url={song.artwork_url} size={24} />
                    <Text
                        className="min-w-0 flex-1 text-xs text-foreground"
                        numberOfLines={1}
                    >
                        {song.title}
                    </Text>
                </View>
            ))}
        </View>
    );
}

/** Titles and artwork come from Apple Music by catalog id. */
function RecentPlays({ plays }: { plays: RecentPlay[] }) {
    const songIds = useMemo(() => plays.map((play) => play.song_id), [plays]);
    const { songInfo } = useSongInfo(songIds);

    return (
        <View className="gap-2">
            <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent plays
            </Text>
            {plays.map((play, index) => {
                const song = songInfo.find(
                    (item) =>
                        item.id === play.song_id ||
                        item.catalogId === play.song_id,
                );
                return (
                    <View
                        key={`${play.song_id}-${play.played_at}-${index}`}
                        className="flex-row items-center gap-3"
                    >
                        <Artwork url={song?.artworkUrl} size={40} />
                        <View className="min-w-0 flex-1">
                            <Text
                                className="text-sm text-foreground"
                                numberOfLines={1}
                            >
                                {song?.title ?? "..."}
                            </Text>
                            <Text
                                className="text-xs text-muted-foreground"
                                numberOfLines={1}
                            >
                                {song?.artistName ?? play.artist_name ?? ""}
                            </Text>
                        </View>
                        <Text className="text-xs text-muted-foreground">
                            {formatRelativeTime(play.played_at)}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

function Artwork({ url, size }: { url?: string | null; size: number }) {
    const { mutedForeground } = useAppTheme().colors;
    return (
        <View
            className="items-center justify-center overflow-hidden rounded-lg bg-secondary"
            style={{ width: size, height: size }}
        >
            {isUsableArtworkUrl(url) ? (
                <Image
                    source={{ uri: url! }}
                    className="h-full w-full"
                    resizeMode="cover"
                />
            ) : (
                <Ionicons
                    name="musical-notes"
                    size={size / 3}
                    color={mutedForeground}
                />
            )}
        </View>
    );
}
