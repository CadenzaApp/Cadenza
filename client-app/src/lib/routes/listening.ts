import { useMemo } from "react";

import { useAPIData, useAPIMutation } from "../api-actions";
import { useRealtimeTopic, useRealtimeTopics } from "../realtime";
import type { RealtimeTopic } from "../realtime-protocol";
import { useFriendships } from "./social";
import type { UpNextSong } from "../now-playing-change";

export type { UpNextSong };

/** How often a listening read refetches while it is on screen. */
const LISTENING_REFRESH_MS = 10_000;

/**
 * A live now playing row. `position_ms` was the position at `as_of`, the
 * server's clock when it answered.
 */
export type NowPlaying = {
    /** Apple Music catalog id. */
    song_id: string;
    title: string;
    artist: string | null;
    album: string | null;
    artwork_url: string | null;
    duration_ms: number | null;
    position_ms: number;
    as_of: string;
    live_session_id: string | null;
    /** The next songs in their queue, at most two. Empty while shuffling. */
    up_next: UpNextSong[];
};

export type FriendListening = {
    user_id: string;
    username: string;
    /** `live_session_id` is set when they host or play along in a session. */
    now_playing: NowPlaying;
    /** The viewer may join that session without a code. */
    can_join: boolean;
};

/** One counted play. The title comes from Apple Music by `song_id`. */
export type RecentPlay = {
    song_id: string;
    played_at: string;
    artist_name: string | null;
    album_name: string | null;
};

/** `now_playing` is null when nothing plays or it is hidden. */
export type UserListening = {
    user_id: string;
    now_playing: NowPlaying | null;
    /** Null when the user hides their history from the viewer. */
    recent_plays: RecentPlay[] | null;
};

/** `PUT /listening/now-playing` body. */
export type NowPlayingUpdate = {
    song_id: string;
    title: string;
    artist: string | null;
    album: string | null;
    artwork_url: string | null;
    duration_ms: number | null;
    is_playing: boolean;
    position_ms: number;
    up_next: UpNextSong[];
};

/**
 * Friends playing something now. Refetches the moment any friend's now
 * playing changes, through the realtime socket, and every 10 s as a fallback.
 * Every friend is watched, not only the ones playing, so one who starts shows
 * up at once.
 */
export function useFriendsListening() {
    const x = useAPIData<{ listening: FriendListening[] }>(
        "/listening/friends",
        undefined,
        { refreshInterval: LISTENING_REFRESH_MS },
    );
    const { friends } = useFriendships();
    const topics = useMemo<RealtimeTopic[]>(
        () => friends.map((friend) => ({ kind: "user", id: friend.user_id })),
        [friends],
    );
    useRealtimeTopics(topics, () => void x.mutate());
    return {
        friendsListening: x.data?.listening,
        friendsListeningLoading: x.isLoading,
        friendsListeningErr: x.error,
    };
}

/**
 * One user's now playing and recent plays, each as their settings allow.
 * Refetches on their changes through the realtime socket, and every 10 s.
 */
export function useUserListening(userId: string | null) {
    const x = useAPIData<UserListening>(
        `/listening/users/${userId}`,
        undefined,
        { enabled: userId !== null, refreshInterval: LISTENING_REFRESH_MS },
    );
    useRealtimeTopic(
        userId ? { kind: "user", id: userId } : null,
        () => void x.mutate(),
    );
    return {
        userListening: x.data,
        userListeningLoading: x.isLoading,
        userListeningErr: x.error,
    };
}

/**
 * Writes and clears the signed-in user's now playing state. Nothing reads
 * the user's own row back, so neither invalidates a read.
 */
export function useNowPlayingWrites() {
    const put = useAPIMutation<NowPlayingUpdate, null>(
        "PUT",
        "/listening/now-playing",
        [],
        { invalidation: "none" },
    );
    const clear = useAPIMutation<void, null>(
        "DELETE",
        "/listening/now-playing",
        [],
        { invalidation: "none" },
    );
    return { putNowPlaying: put.trigger, clearNowPlaying: clear.trigger };
}
