import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, View } from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { MarqueeText } from "@/components/custom/marquee-text";
import { PeekCarousel } from "@/components/custom/peek-carousel";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { withAlpha } from "@/lib/artwork-color";
import { useSongInfo } from "@/lib/musickit-hooks";
import {
    useFriendsListening,
    useUserListening,
    type FriendListening,
    type NowPlaying,
    type RecentPlay,
    type UpNextSong,
} from "@/lib/routes/listening";
import { useJoinListening } from "@/lib/routes/live-sessions";
import { useAppTheme } from "@/lib/theme";
import { cn, isUsableArtworkUrl } from "@/lib/utils";

import {
    markAskedToJoin,
    useHasAskedToJoin,
} from "../live-session/asked-to-join";
import {
    useCurrentLiveSession,
    useShownLiveSession,
} from "../live-session/use-current-session";
import { formatRelativeTime } from "./format";
import { formatTrackTime, livePositionMs } from "./listening-progress";
import { LiveChip } from "./LiveChip";
import { Initials } from "./MemberRow";
import { ShelfHeader } from "./ShelfHeader";

/** Recent plays a profile shows, and how many to a swipeable column. */
const PROFILE_RECENT_PLAYS = 16;
const RECENT_PLAYS_PER_COLUMN = 4;

/** Artwork size on a full card. The progress and up next sit beside it. */
const CARD_ARTWORK_SIZE = 104;

/** How far a tile's gray fades up into the bottom of its artwork. */
const TILE_BLEND = 6;

/** The shade under the title and artist on the art, clear at its top. */
const TITLE_SHADE = ["rgba(0,0,0,0)", "rgba(0,0,0,0.45)"] as const;

/** Past this many friends listening, the header offers See all. */
const STRIP_SEE_ALL_AFTER = 2;

/**
 * The Listening now shelf on the feed: a carousel of friends playing now, two
 * whole and the next peeking in, then the session buttons (start one and
 * enter a code, or open yours). Tapping a friend opens their profile. Join
 * appears on a tile whose friend the viewer may join: their session, or with
 * none, one made for them on the spot. A friend in a live session stays on
 * the row while it is open, paused or not.
 */
export function ListeningNowStrip() {
    const router = useRouter();
    const { friendsListening, friendsListeningLoading, friendsListeningErr } =
        useFriendsListening();
    const listening = friendsListening ?? [];
    const seeAll = listening.length > STRIP_SEE_ALL_AFTER;

    return (
        <View className="mb-2 gap-3">
            <ShelfHeader
                title="Listening now"
                onSeeAll={
                    seeAll
                        ? () => router.push("/social/listening" as Href)
                        : undefined
                }
            />
            {listening.length > 0 ? (
                <PeekCarousel
                    items={listening}
                    keyOf={(friend) => friend.user_id}
                    renderItem={(friend, width) => (
                        <ListeningTile friend={friend} width={width} />
                    )}
                />
            ) : friendsListeningLoading ? (
                <PeekCarousel
                    items={[0, 1, 2]}
                    keyOf={(i) => `skeleton-${i}`}
                    renderItem={(_, width) => (
                        <Skeleton
                            className="rounded-2xl"
                            style={{ width, height: width * 1.6 }}
                        />
                    )}
                />
            ) : (
                <Text className="py-2 text-sm text-muted-foreground">
                    {friendsListeningErr
                        ? "Couldn't load listening"
                        : "No friends playing right now"}
                </Text>
            )}
            <SessionButtons />
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
                <FriendCard key={friend.user_id} friend={friend} />
            ))}
        </View>
    );
}

/**
 * Two buttons side by side: Start a session, or with one open, Open live
 * session; and Join with code. In a session, joining with a code asks first,
 * since a code for another session takes the caller out of this one.
 */
function SessionButtons() {
    const router = useRouter();
    const liveSession = useShownLiveSession();

    function joinWithCode() {
        if (!liveSession) {
            router.push("/join" as Href);
            return;
        }
        Alert.alert(
            "Leave your live session?",
            `Joining another session with a code takes you out of ${liveSession.name}.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Enter a code",
                    style: "destructive",
                    onPress: () => router.push("/join" as Href),
                },
            ],
        );
    }

    return (
        <View className="flex-row gap-3">
            {liveSession ? (
                <SessionAction
                    filled
                    icon="radio"
                    label="Open live session"
                    accessibilityLabel={`Open live session, ${liveSession.name}`}
                    onPress={() => router.push("/player")}
                />
            ) : (
                <SessionAction
                    filled
                    icon="radio-outline"
                    label="Start a session"
                    accessibilityLabel="Start a live session"
                    onPress={() =>
                        router.push("/live-session/new?openPlayer=1" as Href)
                    }
                />
            )}
            <SessionAction
                icon="keypad-outline"
                label="Join with code"
                accessibilityLabel="Join with a code"
                onPress={joinWithCode}
            />
        </View>
    );
}

/** One of the two session buttons. `filled` is the brand colored one. */
function SessionAction({
    filled = false,
    icon,
    label,
    accessibilityLabel,
    onPress,
}: {
    filled?: boolean;
    icon: IoniconName;
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
}) {
    const { brandForeground, foreground } = useAppTheme().colors;
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className={cn(
                "h-12 flex-1 flex-row items-center justify-center gap-2 rounded-2xl active:opacity-70",
                filled ? "bg-brand" : "border border-border bg-muted",
            )}
        >
            <Ionicons
                name={icon}
                size={18}
                color={filled ? brandForeground : foreground}
            />
            <Text
                className={cn(
                    "text-base font-semibold",
                    filled ? "text-brand-foreground" : "text-foreground",
                )}
                numberOfLines={1}
            >
                {label}
            </Text>
        </Pressable>
    );
}

/** A full width card, for See all. Opens the profile. */
function FriendCard({ friend }: { friend: FriendListening }) {
    const router = useRouter();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${friend.username} is playing ${friend.now_playing.title}`}
            onPress={() => router.push(`/social/user/${friend.user_id}`)}
            className="active:opacity-60"
        >
            <ListeningCard
                nowPlaying={friend.now_playing}
                userId={friend.user_id}
                username={friend.username}
                canJoin={friend.can_join}
            />
        </Pressable>
    );
}

/**
 * One friend in the carousel: square artwork with the title and artist on it,
 * over a soft shade, on a tile that is one gray throughout. The art's bottom
 * edge fades into the gray over a few pixels, below the text. Under it the
 * friend and how many are listening, the live progress, then Join when they
 * can be joined. Tiles in a row stretch to the tallest, so
 * Join lines up across them.
 */
function ListeningTile({
    friend,
    width,
}: {
    friend: FriendListening;
    width: number;
}) {
    const router = useRouter();
    const { muted } = useAppTheme().colors;
    const { now_playing: nowPlaying, listener_count: listeners } = friend;

    return (
        <View className="flex-1 overflow-hidden rounded-2xl border border-border bg-muted">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${friend.username} is playing ${nowPlaying.title}, ${listeners} listening`}
                onPress={() => router.push(`/social/user/${friend.user_id}`)}
                className="active:opacity-80"
            >
                <View>
                    <Artwork
                        url={nowPlaying.artwork_url}
                        size={width}
                        rounded={false}
                    />
                    <View className="absolute bottom-0 left-0 right-0">
                        <LinearGradient
                            colors={TITLE_SHADE}
                            style={{
                                gap: 2,
                                paddingHorizontal: 10,
                                paddingTop: 24,
                                // clear of the gray at the art's bottom edge
                                paddingBottom: TILE_BLEND + 6,
                            }}
                        >
                            <MarqueeText className="text-base font-semibold text-white">
                                {nowPlaying.title}
                            </MarqueeText>
                            {nowPlaying.artist ? (
                                <Text
                                    className="text-xs text-white"
                                    numberOfLines={1}
                                >
                                    {nowPlaying.artist}
                                </Text>
                            ) : null}
                        </LinearGradient>
                    </View>
                    <LinearGradient
                        pointerEvents="none"
                        colors={[withAlpha(muted, 0), muted]}
                        style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            bottom: 0,
                            height: TILE_BLEND,
                        }}
                    />
                    {nowPlaying.live_session_id ? (
                        <LiveChip className="absolute left-2 top-2" />
                    ) : null}
                </View>
                <View className="px-2.5 pt-2">
                    <View className="flex-row items-center gap-1.5">
                        <Initials username={friend.username} size={20} />
                        <Text
                            className="min-w-0 flex-shrink text-[11px] font-medium text-foreground"
                            numberOfLines={1}
                        >
                            {friend.username}
                        </Text>
                        <Text
                            className="text-[11px] text-muted-foreground"
                            numberOfLines={1}
                        >
                            · {listeners} listening
                        </Text>
                    </View>
                </View>
            </Pressable>
            <View className="flex-1 justify-between gap-2.5 px-2.5 pb-2.5 pt-2.5">
                <LiveProgress nowPlaying={nowPlaying} />
                {friend.can_join ? (
                    <JoinButton
                        userId={friend.user_id}
                        username={friend.username}
                        appearance="outline"
                    />
                ) : null}
            </View>
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
    const { account } = useAccount();
    const nowPlaying = userListening?.now_playing ?? null;
    const recentPlays = userListening?.recent_plays ?? null;
    if (!nowPlaying && !recentPlays?.length) return null;

    return (
        <View className="gap-6">
            {nowPlaying ? (
                <ListeningCard
                    nowPlaying={nowPlaying}
                    userId={userId}
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
 * to two up next songs beside it. In a live session it carries a LIVE chip.
 * With `canJoin` it has a Join button, which makes a session if there is none.
 */
function ListeningCard({
    nowPlaying,
    userId,
    username,
    canJoin = false,
}: {
    nowPlaying: NowPlaying;
    userId: string;
    username?: string;
    canJoin?: boolean;
}) {
    const { brand } = useAppTheme().colors;
    const sessionId = nowPlaying.live_session_id;

    return (
        <GlassPanel>
            <View className="gap-3 p-4">
                <View className="flex-row gap-3">
                    <View className="min-w-0 flex-1 gap-3">
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
                        </View>

                        <View>
                            <MarqueeText className="text-lg font-semibold text-foreground">
                                {nowPlaying.title}
                            </MarqueeText>
                            {nowPlaying.artist ? (
                                <MarqueeText className="text-sm text-muted-foreground">
                                    {nowPlaying.artist}
                                </MarqueeText>
                            ) : null}
                        </View>
                    </View>
                    {/* the session's chip, and right under it the way in */}
                    {sessionId || canJoin ? (
                        <View className="items-end gap-2">
                            {/* as tall as the avatar row, so the chip lines up with the name */}
                            <View className="h-8 justify-center">
                                {sessionId ? <LiveChip /> : null}
                            </View>
                            {canJoin ? (
                                <JoinButton
                                    userId={userId}
                                    username={username}
                                />
                            ) : null}
                        </View>
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
        </GlassPanel>
    );
}

/**
 * Joins without a code, then opens the session. While the caller waits to be
 * let in it says so, and once they are in with this person it opens the
 * session instead. Both follow the caller's session and the asked marks, so
 * being let in changes it on every card at once. `pill` is the small glass
 * pill on a full card; `outline` fills a carousel tile's width.
 */
function JoinButton({
    userId,
    username,
    appearance = "pill",
}: {
    userId: string;
    username?: string;
    appearance?: "pill" | "outline";
}) {
    const router = useRouter();
    const { joinListening, joinListeningLoading } = useJoinListening();
    const asked = useHasAskedToJoin(userId);
    const [refused, setRefused] = useState(false);
    const mine = useCurrentLiveSession();
    const together =
        mine !== null &&
        (mine.host.user_id === userId ||
            mine.members.some((member) => member.user_id === userId));

    async function join() {
        try {
            const { status, session_id } = await joinListening({
                user_id: userId,
            });
            if (status === "asked") {
                markAskedToJoin(session_id, userId);
                return;
            }
            router.push("/player");
        } catch {
            setRefused(true);
        }
    }

    if (together) {
        return (
            <JoinAction
                appearance={appearance}
                icon="radio-outline"
                label="Open"
                accessibilityLabel={`Open the session with ${username ?? "them"}`}
                onPress={() => router.push("/player")}
            />
        );
    }
    if (asked || refused) {
        return (
            <Text
                className={cn(
                    "text-xs text-muted-foreground",
                    appearance === "pill"
                        ? "max-w-28 text-right"
                        : "text-center",
                )}
            >
                {asked
                    ? `Asked to join. ${username ?? "They"} will let you in.`
                    : `Ask ${username ?? "them"} for a code to join.`}
            </Text>
        );
    }
    return (
        <JoinAction
            appearance={appearance}
            icon="enter-outline"
            label="Join"
            loading={joinListeningLoading}
            accessibilityLabel={`Join ${username ?? "their"}'s session`}
            onPress={() => void join()}
        />
    );
}

/**
 * The button Join draws: on a tile a small centered pill, brand colored with
 * a faint brand fill inside its rim, or a glass pill on a full card. The fill
 * is the brand color with alpha, since a `/NN` class takes no opacity on a
 * theme color.
 */
function JoinAction({
    appearance,
    icon,
    label,
    loading = false,
    accessibilityLabel,
    onPress,
}: {
    appearance: "pill" | "outline";
    icon: IoniconName;
    label: string;
    loading?: boolean;
    accessibilityLabel: string;
    onPress: () => void;
}) {
    const { brand } = useAppTheme().colors;
    if (appearance === "pill") {
        return (
            <View className="items-end">
                <GlassPill
                    size="sm"
                    icon={icon}
                    label={label}
                    loading={loading}
                    accessibilityLabel={accessibilityLabel}
                    onPress={onPress}
                />
            </View>
        );
    }
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ busy: loading }}
            disabled={loading}
            onPress={onPress}
            className="h-7 flex-row items-center justify-center gap-1 self-center rounded-full border border-brand px-4 active:opacity-60"
            style={{ backgroundColor: withAlpha(brand, 0.15) }}
        >
            {loading ? (
                <ActivityIndicator size="small" color={brand} />
            ) : (
                <Ionicons name={icon} size={14} color={brand} />
            )}
            <Text className="text-xs font-semibold text-brand">{label}</Text>
        </Pressable>
    );
}

/** A bar, then where it is and how long it runs as `m:ss`. Ticks each second. */
function LiveProgress({ nowPlaying }: { nowPlaying: NowPlaying }) {
    const { position_ms, as_of, duration_ms, is_playing } = nowPlaying;
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!is_playing) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [is_playing]);

    const position = is_playing
        ? livePositionMs(position_ms, as_of, duration_ms, now)
        : position_ms;
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

/**
 * Recent plays in columns of four, swiped through sideways, with the next
 * column peeking in. Titles and artwork come from Apple Music by catalog id,
 * looked up once for every column.
 */
function RecentPlays({ plays }: { plays: RecentPlay[] }) {
    const songIds = useMemo(() => plays.map((play) => play.song_id), [plays]);
    const { songInfo } = useSongInfo(songIds);
    const columns = useMemo(() => {
        const out: RecentPlay[][] = [];
        for (let i = 0; i < plays.length; i += RECENT_PLAYS_PER_COLUMN) {
            out.push(plays.slice(i, i + RECENT_PLAYS_PER_COLUMN));
        }
        return out;
    }, [plays]);

    return (
        <View className="gap-3">
            <ShelfHeader title="Recent plays" />
            <PeekCarousel
                items={columns}
                visible={1}
                keyOf={(_, index) => `column-${index}`}
                renderItem={(column, _width, columnIndex) => (
                    <View className="gap-2.5">
                        {column.map((play, index) => {
                            const song = songInfo.find(
                                (item) =>
                                    item.id === play.song_id ||
                                    item.catalogId === play.song_id,
                            );
                            return (
                                <View
                                    key={`${play.song_id}-${play.played_at}-${columnIndex}-${index}`}
                                    className="flex-row items-center gap-3"
                                >
                                    <Artwork url={song?.artworkUrl} size={44} />
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
                                            {song?.artistName ??
                                                play.artist_name ??
                                                ""}
                                        </Text>
                                    </View>
                                    <Text className="text-xs text-muted-foreground">
                                        {formatRelativeTime(play.played_at)}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                )}
            />
        </View>
    );
}

/** Square unless `height` is given. `rounded` off for art that fills a tile. */
function Artwork({
    url,
    size,
    height = size,
    rounded = true,
}: {
    url?: string | null;
    size: number;
    height?: number;
    rounded?: boolean;
}) {
    const { mutedForeground } = useAppTheme().colors;
    return (
        <View
            className={cn(
                "items-center justify-center overflow-hidden bg-secondary",
                rounded && "rounded-lg",
            )}
            style={{ width: size, height }}
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
