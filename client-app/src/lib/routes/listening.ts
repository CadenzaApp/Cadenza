import { useAPIData, useAPIMutation } from "../api-actions";

/** How often the listening now strip refetches while it is on screen. */
const FRIENDS_LISTENING_REFRESH_MS = 30_000;

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
};

export type FriendListening = {
    user_id: string;
    username: string;
    now_playing: NowPlaying;
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
};

/** Friends playing something now, refetched every 30 s while mounted. */
export function useFriendsListening() {
    const x = useAPIData<{ listening: FriendListening[] }>(
        "/listening/friends",
        undefined,
        { refreshInterval: FRIENDS_LISTENING_REFRESH_MS },
    );
    return {
        friendsListening: x.data?.listening,
        friendsListeningLoading: x.isLoading,
        friendsListeningErr: x.error,
    };
}

/** One user's now playing and recent plays, each as their settings allow. */
export function useUserListening(userId: string | null) {
    const x = useAPIData<UserListening>(
        `/listening/users/${userId}`,
        undefined,
        { enabled: userId !== null },
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
