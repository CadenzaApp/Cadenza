import type { SocialFriend } from "@/lib/types";

/**
 * Whether a friend shows the green dot: the app open, or playing something
 * now. `listeningIds` is who `useFriendsListening` returned.
 */
export function isFriendOnline(
    friend: SocialFriend,
    listeningIds: ReadonlySet<string>,
) {
    return friend.online || listeningIds.has(friend.user_id);
}

/**
 * Online friends first. Stable, so the server's favorites first, then
 * username order holds inside each group.
 */
export function onlineFirst(
    friends: readonly SocialFriend[],
    listeningIds: ReadonlySet<string>,
) {
    return [...friends].sort(
        (a, b) =>
            Number(isFriendOnline(b, listeningIds)) -
            Number(isFriendOnline(a, listeningIds)),
    );
}
