import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useSongInfo } from "@/lib/musickit-hooks";
import {
    useFriendsListening,
    useUserListening,
    type FriendListening,
    type NowPlaying,
    type RecentPlay,
    type UpNextSong,
} from "@/lib/routes/listening";
import {
    useJoinLiveSession,
    useLiveSession,
    useMyLiveSession,
} from "@/lib/routes/live-sessions";
import { useAppTheme } from "@/lib/theme";
import { isUsableArtworkUrl } from "@/lib/utils";

import { formatRelativeTime } from "./format";
import { formatTrackTime, livePositionMs } from "./listening-progress";
import { LiveChip } from "./LiveChip";
import { Initials } from "./MemberRow";

/** Recent plays a profile shows. */
const PROFILE_RECENT_PLAYS = 10;

/** How wide the featured card is in the feed's row, so the next one peeks in. */
const STRIP_CARD_WIDTH = 300;

/** Artwork size on a card. The progress and up next sit beside it. */
const CARD_ARTWORK_SIZE = 104;

/** Small tiles in the row, and the session tile, are this wide. */
const TILE_WIDTH = 112;

/** Past this many friends listening, the header offers See all. */
const STRIP_SEE_ALL_AFTER = 4;

/**
 * The Listening now row at the top of the feed: your session tile first
 * (start one, enter a code, or open yours), then the most recent friend as a
 * full card, then the rest as small tiles. Tapping a friend opens their
 * profile. Join appears on a card whose friend is in a session the viewer may
 * join.
 */
export function ListeningNowStrip() {
    const router = useRouter();
    const { friendsListening, friendsListeningLoading, friendsListeningErr } =
        useFriendsListening();
    const { mutedForeground } = useAppTheme().colors;
    const [featured, ...rest] = friendsListening ?? [];

    return (
        <View className="mb-2 gap-2">
            <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-1.5">
                    <Ionicons
                        name="headset-outline"
                        size={14}
                        color={mutedForeground}
                    />
                    <Text className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                        Listening now
                    </Text>
                </View>
                {(friendsListening?.length ?? 0) > STRIP_SEE_ALL_AFTER ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="See all friends listening"
                        onPress={() => router.push("/social/listening" as Href)}
                        className="flex-row items-center gap-0.5 active:opacity-60"
                    >
                        <Text className="text-sm font-semibold text-brand">
                            See all
                        </Text>
                        <Ionicons name="chevron-forward" size={14} />
                    </Pressable>
                ) : null}
            </View>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="-mx-5"
                contentContainerClassName="gap-3 px-5"
            >
                <SessionTile />
                {featured ? (
                    <FriendCard friend={featured} />
                ) : friendsListeningLoading ? (
                    <Skeleton
                        className="rounded-3xl"
                        style={{ width: STRIP_CARD_WIDTH, height: 220 }}
                    />
                ) : (
                    <View className="justify-center px-2">
                        <Text className="text-sm text-muted-foreground">
                            {friendsListeningErr
                                ? "Couldn't load listening"
                                : "No friends playing right now"}
                        </Text>
                    </View>
                )}
                {rest.map((friend) => (
                    <CompactListeningTile
                        key={friend.user_id}
                        friend={friend}
                    />
                ))}
            </ScrollView>
        </View>
    );
}

/**
 * Every friend listening, full cards in a column, for See all.
 */
export function AllListening() {
    const { friendsListening, friendsListeningErr } = useFriendsListening();
    if (friendsListeningErr) {
        return <ErrorNotice error={friendsListeningErr} />;
    }
    if (!friendsListening?.length) {
        return (
            <Text className="py-10 text-center text-sm text-muted-foreground">
                No friends playing right now.
            </Text>
        );
    }
    return (
        <View className="gap-3">
            {friendsListening.map((friend) => (
                <FriendCard key={friend.user_id} friend={friend} fullWidth />
            ))}
        </View>
    );
}

/** Start a session or enter a code; or, when in one, open it. */
function SessionTile() {
    const router = useRouter();
    const { mySessionId } = useMyLiveSession();
    const { liveSession } = useLiveSession(mySessionId);
    const { brand, foreground } = useAppTheme().colors;

    if (mySessionId && liveSession) {
        const art = liveSession.current?.artwork_url;
        return (
            <GlassPanel tintColor={`${brand}33`}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open your live session, ${liveSession.name}`}
                    onPress={() =>
                        router.push(`/live-session/${mySessionId}` as Href)
                    }
                    className="flex-1 gap-2 p-3 active:opacity-60"
                    style={{ width: TILE_WIDTH }}
                >
                    <LiveChip />
                    <Text
                        className="text-sm font-semibold text-foreground"
                        numberOfLines={2}
                    >
                        {liveSession.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                        {liveSession.members.length} listening
                    </Text>
                    <View className="mt-auto">
                        <Artwork url={art} size={40} />
                    </View>
                </Pressable>
            </GlassPanel>
        );
    }

    return (
        <GlassPanel>
            <View className="flex-1 gap-2 p-3" style={{ width: TILE_WIDTH }}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start a live session"
                    onPress={() => router.push("/live-session/new" as Href)}
                    className="items-center gap-2 active:opacity-60"
                >
                    <View className="h-11 w-11 items-center justify-center rounded-full bg-muted/60">
                        <Ionicons
                            name="radio-outline"
                            size={22}
                            color={foreground}
                        />
                    </View>
                    <Text className="text-center text-sm font-semibold text-foreground">
                        Start session
                    </Text>
                </Pressable>
                <View className="mt-auto items-center">
                    <GlassPill
                        size="sm"
                        icon="keypad-outline"
                        label="Code"
                        accessibilityLabel="Join with a code"
                        onPress={() => router.push("/join" as Href)}
                    />
                </View>
            </View>
        </GlassPanel>
    );
}

/** The featured card in the row, or a full width card in See all. */
function FriendCard({
    friend,
    fullWidth = false,
}: {
    friend: FriendListening;
    fullWidth?: boolean;
}) {
    const router = useRouter();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${friend.username} is playing ${friend.now_playing.title}`}
            onPress={() => router.push(`/social/user/${friend.user_id}`)}
            className="active:opacity-60"
            style={fullWidth ? undefined : { width: STRIP_CARD_WIDTH }}
        >
            <ListeningCard
                nowPlaying={friend.now_playing}
                username={friend.username}
                canJoin={friend.can_join}
            />
        </Pressable>
    );
}

/** A small tile: art, song title, who. Opens the profile. */
function CompactListeningTile({ friend }: { friend: FriendListening }) {
    const router = useRouter();
    const { now_playing: nowPlaying } = friend;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${friend.username} is playing ${nowPlaying.title}`}
            onPress={() => router.push(`/social/user/${friend.user_id}`)}
            className="active:opacity-60"
            style={{ width: TILE_WIDTH }}
        >
            <View>
                <Artwork url={nowPlaying.artwork_url} size={TILE_WIDTH} />
                {nowPlaying.live_session_id ? (
                    <LiveChip className="absolute left-1.5 top-1.5" />
                ) : null}
            </View>
            <View className="mt-2 gap-0.5">
                <Text
                    className="text-sm font-semibold text-foreground"
                    numberOfLines={1}
                >
                    {nowPlaying.title}
                </Text>
                <View className="flex-row items-center gap-1">
                    <Initials username={friend.username} size={20} />
                    <Text
                        className="min-w-0 flex-1 text-xs text-muted-foreground"
                        numberOfLines={1}
                    >
                        {friend.username}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

/**
 * What one user is playing now and their recent plays, each as their privacy
 * settings allow. A hidden or empty part is left out, so a private profile
 * draws nothing here.
 */
export function ProfileListening({ userId }: { userId: string }) {
    const { userListening } = useUserListening(userId);
    const { account } = useAccount();
    const nowPlaying = userListening?.now_playing ?? null;
    const recentPlays = userListening?.recent_plays ?? null;
    if (!nowPlaying && !recentPlays?.length) return null;

    return (
        <View className="mb-4 gap-4 border-b border-border pb-5">
            {nowPlaying ? (
                <ListeningCard
                    nowPlaying={nowPlaying}
                    // the backend says no when it is not allowed; a code is the way in then
                    canJoin={account?.id !== userId}
                />
            ) : null}
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
 * label, for a profile), the song, then the artwork with live progress and up
 * to two up next songs beside it. In a live session it carries a LIVE chip,
 * and a Join button when `canJoin`.
 */
function ListeningCard({
    nowPlaying,
    username,
    canJoin = false,
}: {
    nowPlaying: NowPlaying;
    username?: string;
    canJoin?: boolean;
}) {
    const { brand } = useAppTheme().colors;
    const sessionId = nowPlaying.live_session_id;

    return (
        <GlassPanel>
            <View className="gap-3 p-4">
                <View className="flex-row items-center gap-2">
                    {username ? (
                        <>
                            <Initials username={username} size={32} />
                            <Text
                                className="min-w-0 flex-1 font-semibold text-foreground"
                                numberOfLines={1}
                            >
                                {username}
                            </Text>
                        </>
                    ) : (
                        <View className="flex-1 flex-row items-center gap-1">
                            <Ionicons
                                name="musical-note"
                                size={12}
                                color={brand}
                            />
                            <Text className="text-xs font-semibold uppercase tracking-wider text-brand">
                                Playing now
                            </Text>
                        </View>
                    )}
                    {sessionId ? <LiveChip /> : null}
                </View>

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
                        {sessionId && canJoin ? (
                            <JoinButton
                                sessionId={sessionId}
                                username={username}
                            />
                        ) : null}
                    </View>
                </View>
            </View>
        </GlassPanel>
    );
}

/** Joins without a code, then opens the session. */
function JoinButton({
    sessionId,
    username,
}: {
    sessionId: string;
    username?: string;
}) {
    const router = useRouter();
    const { joinLiveSession, joinLiveSessionLoading } = useJoinLiveSession();
    const [refused, setRefused] = useState(false);

    async function join() {
        try {
            await joinLiveSession({ session_id: sessionId });
            router.push(`/live-session/${sessionId}` as Href);
        } catch {
            setRefused(true);
        }
    }

    if (refused) {
        return (
            <Text className="text-xs text-muted-foreground">
                Ask {username ?? "them"} for a code to join.
            </Text>
        );
    }
    return (
        <View className="items-start">
            <GlassPill
                size="sm"
                icon="enter-outline"
                label="Join"
                loading={joinLiveSessionLoading}
                accessibilityLabel={`Join ${username ?? "their"}'s session`}
                onPress={() => void join()}
            />
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
                    className="h-full rounded-full bg-brand"
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
