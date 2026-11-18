import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    useWindowDimensions,
    View,
} from "react-native";

import { ErrorNotice } from "@/components/custom/error-notice";
import { CadenzaLogo } from "@/components/custom/cadenza-logo";
import { MarqueeText } from "@/components/custom/marquee-text";
import { PeekCarousel } from "@/components/custom/peek-carousel";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassPill } from "@/components/ui/glass-pill";
import type { IoniconName } from "@/components/ui/ionicon-name";
import { RemoteArtwork } from "@/components/ui/remote-artwork";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/account";
import { useProfile } from "@/lib/routes/profile";
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
import { cn } from "@/lib/utils";

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
import { SessionActionsMenu } from "./SessionActionsMenu";
import { ShelfHeader } from "./ShelfHeader";
import { ModalPopup } from "@/components/custom/modal-popup";

/** Recent plays a profile shows, and how many to a swipeable column. */
const PROFILE_RECENT_PLAYS = 16;
const RECENT_PLAYS_PER_COLUMN = 4;

/** Artwork size on a full card. The progress and up next sit beside it. */
const CARD_ARTWORK_SIZE = 104;
/** How far a tile's gray fades up into the bottom of its artwork. */
const TILE_BLEND = 6;

/** The shade under the title and artist on the art, clear at its top. */
const TITLE_SHADE = ["rgba(0,0,0,0)", "rgba(0,0,0,0.45)"] as const;

/** The gray ring on a bubble that is not live. */
function neutralRing(mutedForeground: string) {
    return withAlpha(mutedForeground, 0.55);
}

const STORY_GUTTER = 20;
const STORY_GAP = 16;
const STORY_PEEK = 12;
const STORY_TARGET_SIZE = 70;

const PLACEHOLDER_STORIES = [
    {
        user_id: "placeholder-live-friend",
        username: "Maya",
        can_join: true,
        listener_count: 3,
        now_playing: {
            song_id: "placeholder-live-song",
            title: "Midnight City",
            artist: "M83",
            album: null,
            artwork_url:
                "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=256&q=80",
            duration_ms: null,
            is_playing: true,
            position_ms: 0,
            as_of: new Date(0).toISOString(),
            live_session_id: "placeholder-live-session",
            up_next: [],
        },
    },
    {
        user_id: "placeholder-listening-friend",
        username: "Noah",
        can_join: false,
        listener_count: 1,
        now_playing: {
            song_id: "placeholder-listening-song",
            title: "Blue in Green",
            artist: "Miles Davis",
            album: null,
            artwork_url:
                "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=256&q=80",
            duration_ms: null,
            is_playing: true,
            position_ms: 0,
            as_of: new Date(0).toISOString(),
            live_session_id: null,
            up_next: [],
        },
    },
] satisfies FriendListening[];

/**
 * The compact Listening now shelf on the feed. It intentionally begins with
 * two visual placeholders while real presence data is being connected to this
 * new treatment. A ring in the user's accent marks a session that can be
 * joined without a code; the neutral rim marks ordinary listening.
 */
export function ListeningNowStrip() {
    const router = useRouter();
    const { mutedForeground } = useAppTheme().colors;
    const joinRing = neutralRing(mutedForeground);
    const { width: screenWidth } = useWindowDimensions();
    const [viewportWidth, setViewportWidth] = useState(0);
    const usableWidth = Math.max(
        1,
        (viewportWidth || screenWidth) - STORY_GUTTER,
    );
    const visibleCount = Math.max(
        1,
        Math.floor(
            (usableWidth - STORY_PEEK) / (STORY_TARGET_SIZE + STORY_GAP),
        ),
    );
    const storySize = Math.max(
        1,
        (usableWidth - STORY_PEEK - visibleCount * STORY_GAP) / visibleCount,
    );
    const { friendsListening } = useFriendsListening();
    const { profile } = useProfile();
    const { account } = useAccount();
    const myStory = useMyStory(account?.id ?? null);
    const stories = [...PLACEHOLDER_STORIES, ...(friendsListening ?? [])];

    return (
        <View
            style={{ marginHorizontal: -STORY_GUTTER }}
            onLayout={(event) =>
                setViewportWidth(event.nativeEvent.layout.width)
            }
        >
            <ScrollView
                horizontal
                directionalLockEnabled
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                snapToInterval={storySize + STORY_GAP}
                contentContainerStyle={{
                    gap: STORY_GAP,
                    paddingHorizontal: STORY_GUTTER,
                }}
            >
                <YourListeningStory
                    username={
                        profile?.username ??
                        account?.email?.split("@")[0] ??
                        "You"
                    }
                    artworkUrl={myStory.artworkUrl}
                    live={myStory.live}
                    size={storySize}
                />
                {stories.map((friend) => (
                    <ListeningStory
                        key={friend.user_id}
                        friend={friend}
                        size={storySize}
                    />
                ))}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Join listening session"
                    onPress={() => router.push("/join")}
                    className="items-center gap-1.5 active:opacity-60"
                    style={{ width: storySize }}
                >
                    <View
                        className="items-center justify-center rounded-full border-2"
                        style={{
                            width: storySize,
                            height: storySize,
                            borderColor: joinRing,
                        }}
                    >
                        <CadenzaLogo size={storySize * 0.42} color={joinRing} />
                    </View>
                    <Text
                        className="w-full text-center text-xs text-foreground"
                        numberOfLines={1}
                    >
                        Join session
                    </Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

/**
 * What the caller's own bubble shows. Live (hosting, or playing along synced,
 * in a session that shows as live, the same rule friends see) it is the
 * session's song, paused or not, or nothing with no song queued. Otherwise it
 * is what they play now, which drops off when they stop.
 */
function useMyStory(userId: string | null) {
    const { userListening } = useUserListening(userId);
    const session = useShownLiveSession();
    const live =
        session !== null &&
        (session.my_role === "host" || session.my_listen_mode === "synced");
    if (live) {
        const song = session.current ?? session.up_next[0] ?? null;
        return { live, artworkUrl: song?.artwork_url ?? null };
    }
    return {
        live,
        artworkUrl: userListening?.now_playing?.artwork_url ?? null,
    };
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
 * The caller's own bubble, labeled Your listening. Tapping it opens their live
 * session when they are in one, else the session menu. The + on its corner
 * always opens the session menu.
 */
function YourListeningStory({
    username,
    artworkUrl,
    live,
    size,
}: {
    username: string;
    artworkUrl?: string | null;
    live: boolean;
    size: number;
}) {
    const router = useRouter();
    const session = useCurrentLiveSession();
    const { brand, mutedForeground } = useAppTheme().colors;
    const [menuOpen, setMenuOpen] = useState(false);
    const badgeSize = Math.round(size * 0.4);
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                    session ? "Open your live session" : "Your listening"
                }
                onPress={() =>
                    session ? router.push("/player") : setMenuOpen(true)
                }
                className="items-center gap-1.5 active:opacity-60"
                style={{ width: size }}
            >
                <View>
                    {artworkUrl ? (
                        <StoryRing
                            artworkUrl={artworkUrl}
                            live={live}
                            size={size}
                        />
                    ) : (
                        <View
                            className="items-center justify-center rounded-full border-2 border-border bg-muted"
                            style={{ width: size, height: size }}
                        >
                            <Text className="text-lg font-semibold text-foreground">
                                {username.slice(0, 1).toUpperCase()}
                            </Text>
                        </View>
                    )}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Start or join a live session"
                        hitSlop={6}
                        onPress={() => setMenuOpen(true)}
                        className="absolute bottom-0 right-0 items-center justify-center rounded-full border-2 active:opacity-60"
                        style={{
                            width: badgeSize,
                            height: badgeSize,
                            backgroundColor: brand,
                            borderColor: neutralRing(mutedForeground),
                        }}
                    >
                        <Ionicons
                            name="add"
                            size={badgeSize * 0.8}
                            color="white"
                        />
                    </Pressable>
                </View>
                <Text
                    className="w-full text-center text-xs text-foreground"
                    numberOfLines={1}
                >
                    Your listening
                </Text>
            </Pressable>
            <SessionActionsMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
            />
        </>
    );
}

function ListeningStory({
    friend,
    size,
}: {
    friend: FriendListening;
    size: number;
}) {
    const [open, setOpen] = useState(false);
    const live = Boolean(friend.now_playing.live_session_id && friend.can_join);
    return (
        <>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${friend.username} is listening to ${friend.now_playing.title}`}
                onPress={() => setOpen(true)}
                className="items-center gap-1.5 active:opacity-60"
                style={{ width: size }}
            >
                <StoryRing
                    artworkUrl={friend.now_playing.artwork_url}
                    live={live}
                    size={size}
                />
                <Text
                    className="w-full text-center text-xs text-foreground"
                    numberOfLines={1}
                >
                    {friend.username}
                </Text>
            </Pressable>
            <ListeningStoryDialog
                friend={friend}
                open={open}
                onClose={() => setOpen(false)}
            />
        </>
    );
}

/**
 * A listening bubble: the song's art inset in a ring, the accent color when
 * live, a neutral gray otherwise.
 */
function StoryRing({
    artworkUrl,
    live,
    size,
}: {
    artworkUrl: string | null;
    live: boolean;
    size: number;
}) {
    const { brand, mutedForeground } = useAppTheme().colors;
    return (
        <View
            style={{
                width: size,
                height: size,
                borderColor: live ? brand : neutralRing(mutedForeground),
            }}
            className="items-center justify-center rounded-full border-2 p-1"
        >
            <RemoteArtwork
                url={artworkUrl}
                className="h-full w-full rounded-full"
                fallback={
                    <Ionicons name="musical-note" size={22} color={brand} />
                }
            />
        </View>
    );
}

export function ListeningStoryDialog({
    friend,
    open,
    onClose,
}: {
    friend: FriendListening;
    open: boolean;
    onClose: () => void;
}) {
    const [width, setWidth] = useState(0);
    return (
        <ModalPopup
            visible={open}
            onClose={onClose}
            variant="transparent"
            contentStyle={{ padding: 0 }}
        >
            {/* the tile's art is square at the popup's width, so wait for it */}
            <View
                onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            >
                {width > 0 ? (
                    <ListeningTile
                        friend={friend}
                        width={width}
                        onOpenProfile={onClose}
                    />
                ) : null}
            </View>
        </ModalPopup>
    );
}

/**
 * One friend's listening as a tile: square artwork with the title and artist
 * on it, over a soft shade, on a tile that is one gray throughout. The art's
 * bottom edge fades into the gray over a few pixels, below the text. Under it
 * the friend and how many are listening, the live progress, then Join when
 * they can be joined. Tapping the art or name opens their profile, after
 * `onOpenProfile`.
 */
function ListeningTile({
    friend,
    width,
    onOpenProfile,
}: {
    friend: FriendListening;
    width: number;
    onOpenProfile?: () => void;
}) {
    const router = useRouter();
    const { muted } = useAppTheme().colors;
    const { now_playing: nowPlaying, listener_count: listeners } = friend;

    return (
        <View className="overflow-hidden rounded-2xl border border-border bg-muted">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${friend.username} is playing ${nowPlaying.title}, ${listeners} listening`}
                onPress={() => {
                    onOpenProfile?.();
                    router.push(`/social/user/${friend.user_id}`);
                }}
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
            <View className="gap-2.5 px-2.5 pb-2.5 pt-2.5">
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

/** Square. `rounded` off for art that fills a tile. */
function Artwork({
    url,
    size,
    rounded = true,
}: {
    url?: string | null;
    size: number;
    rounded?: boolean;
}) {
    const { mutedForeground } = useAppTheme().colors;
    return (
        <RemoteArtwork
            url={url}
            className={cn("bg-secondary", rounded && "rounded-lg")}
            style={{ width: size, height: size }}
            fallback={
                <Ionicons
                    name="musical-notes"
                    size={size / 3}
                    color={mutedForeground}
                />
            }
        />
    );
}
