import { useCallback, useMemo, useRef } from "react";
import { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";

import { useAccount } from "../account";
import { fetchAPIData, useAPIData, useAPIMutation } from "../api-actions";
import { useRealtimeTopics } from "../realtime";
import type { RealtimeTopic } from "../realtime-protocol";
import {
    applyCommentContent,
    applyCommentLike,
    applyPostCommentDelta,
    commentsPath,
    insertCachedComment,
    isFirstPostCommentsPageKey,
    isInfinitePostCommentsKey,
    isPostCommentsKey,
    removeCachedComment,
    isSocialPostPages,
} from "../post-comment";
import {
    applyPostContent,
    applyPostLike,
    isSocialPostListKey,
    removePost,
} from "../post-like";
import type {
    InterestScoreDelta,
    SocialComment,
    Friendships,
    SocialNotification,
    SocialReply,
    SocialPost,
    UserSearchPerson,
    SocialUserProfile,
} from "@/lib/types";

/** Matches the backend feed page size. A shorter page means this mode is done. */
const FEED_PAGE_SIZE = 10;

const EMPTY_POSTS: SocialPost[] = [];

function uniqueById<Page, Row>(
    pages: readonly Page[] | undefined,
    rows: (page: Page) => readonly Row[],
    id: (row: Row) => number,
    empty: Row[],
): Row[] {
    if (!pages) return empty;
    const seen = new Set<number>();
    const items: Row[] = [];
    for (const page of pages) {
        for (const row of rows(page)) {
            const key = id(row);
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(row);
        }
    }
    return items;
}

/**
 * Shrinks the signed in user's interest scores so the social feed follows what
 * they like now rather than what they liked months ago. The social feed service
 * skips it when it already decayed in the last 6 hours, so calling it more than
 * that is harmless. No body: the backend puts the user id in.
 */
export function useDecayInterests() {
    const x = useAPIMutation<void, void>("PATCH", "/social/interests/decay");
    return {
        decayInterestsErr: x.error,
        decayInterestsLoading: x.isMutating,
        resetDecayInterests: x.reset,
        decayInterests: x.trigger,
    };
}

type EditInterestScoresPayload = {
    delta_scores: InterestScoreDelta[];
};

/**
 * Moves the signed in user's interest score for each named artist or genre by
 * its delta, which is what the social feed ranks posts by. An interest they
 * have no score for starts at its delta. Responds with `null`.
 *
 * ```ts
 * await editInterestScores({
 *     delta_scores: [
 *         { name: "Phoebe Bridgers", itype: "artist", delta: 1 },
 *         { name: "Alternative", itype: "genre", delta: 1 },
 *     ],
 * });
 * ```
 *
 * The backend forwards it to the social feed service with the caller's user
 * id added, so the body never names a user.
 */
export function useEditInterestScores() {
    const x = useAPIMutation<EditInterestScoresPayload, null>(
        "PATCH",
        "/social/interests/update",
    );
    return {
        editInterestScoresErr: x.error,
        editInterestScoresLoading: x.isMutating,
        resetEditInterestScores: x.reset,
        editInterestScores: x.trigger,
    };
}

type FeedResponse = {
    feed: SocialPost[];
};

type FeedPageKey = {
    keyType: "api-data";
    path: "/social/feed";
    params: Record<string, unknown>;
    accountId: string;
    /** Distinguishes pages so each scroll-triggered call hits the network. */
    pageIndex: number;
};

function feedPagePosts(pages: FeedResponse[] | undefined): SocialPost[] {
    const seen = new Set<number>();
    const posts: SocialPost[] = [];
    for (const page of pages ?? []) {
        for (const post of page.feed) {
            if (seen.has(post.post_id)) continue;
            seen.add(post.post_id);
            posts.push(post);
        }
    }
    return posts;
}

function feedPageIsFull(page: FeedResponse | null | undefined): boolean {
    return (page?.feed.length ?? 0) >= FEED_PAGE_SIZE;
}

function isLoadingNextFeedPage(
    size: number,
    data: FeedResponse[] | undefined,
    isValidating: boolean,
) {
    return isValidating && Boolean(data?.length) && size > (data?.length ?? 0);
}

/** Matches the backend's friends feed page size. A shorter page is the end. */
const FRIENDS_FEED_PAGE_SIZE = 20;

/**
 * Posts by friends and you, newest first, for the Friends filter. Pages back
 * by the last post's time. Read only: nothing is marked loaded.
 */
export function useFriendsFeed(enabled: boolean) {
    const { account } = useAccount();
    const x = useSWRInfinite<FeedResponse>(
        (pageIndex, previousPage: FeedResponse | null) => {
            if (!enabled || !account) return null;
            if (pageIndex > 0) {
                const last = previousPage?.feed.at(-1);
                if (!last || previousPage!.feed.length < FRIENDS_FEED_PAGE_SIZE)
                    return null;
                return {
                    keyType: "api-data",
                    path: "/social/feed/friends",
                    params: { before: last.created_at },
                    accountId: account.id,
                };
            }
            return {
                keyType: "api-data",
                path: "/social/feed/friends",
                params: {},
                accountId: account.id,
            };
        },
        (key: { path: string; params: Record<string, string> }) =>
            fetchAPIData<FeedResponse>(key.path, key.params),
        { revalidateFirstPage: false },
    );
    const pages = x.data ?? [];
    const lastPage = pages.at(-1);
    const hasNextPage =
        lastPage !== undefined &&
        lastPage.feed.length >= FRIENDS_FEED_PAGE_SIZE;
    const isLoadingNextPage =
        x.size > 0 && x.data !== undefined && x.data.length < x.size;

    return {
        friendsPosts: pages.flatMap((page) => page.feed),
        friendsFeedLoading: x.isLoading,
        friendsFeedErr: x.error,
        hasNextFriendsPage: hasNextPage,
        isLoadingNextFriendsPage: isLoadingNextPage,
        loadNextFriendsPage: () => x.setSize(x.size + 1),
        refreshFriendsFeed: () => x.mutate(),
    };
}

/**
 * Ranked posts for the signed-in user, paged like the library lists. Each
 * page already includes everything needed to render a card.
 *
 * First page uses `exclude=viewed` (skip only fully viewed posts). Later
 * pages use `exclude=loaded` (skip anything /feed already returned). The
 * service marks returned ids as `loaded`. When never-loaded posts run out,
 * continues with `exclude=none` after the caught-up separator.
 */
export function useFeed() {
    const { account } = useAccount();

    // Do not revalidate earlier pages when size grows: /feed's ranking shifts
    // as rows are marked loaded/viewed, so refetching page 0 would replace the
    // list instead of appending the next page.
    const feedSwrOptions = {
        revalidateFirstPage: false,
        revalidateAll: false,
    } as const;

    const fresh = useSWRInfinite<FeedResponse>(
        (pageIndex, previousPage): FeedPageKey | null => {
            if (!account) return null;
            if (pageIndex > 0 && !feedPageIsFull(previousPage)) return null;
            return {
                keyType: "api-data",
                path: "/social/feed",
                // first paint: anything not viewed; scroll: only never-loaded
                params: { exclude: pageIndex === 0 ? "viewed" : "loaded" },
                accountId: account.id,
                pageIndex,
            };
        },
        (key: FeedPageKey) => fetchAPIData<FeedResponse>(key.path, key.params),
        feedSwrOptions,
    );

    const freshExhausted =
        fresh.data != null &&
        (fresh.data.length === 0 ||
            !feedPageIsFull(fresh.data[fresh.data.length - 1]));

    const caughtUp = useSWRInfinite<FeedResponse>(
        (pageIndex, previousPage): FeedPageKey | null => {
            if (!account || !freshExhausted) return null;
            if (pageIndex > 0 && !feedPageIsFull(previousPage)) return null;
            return {
                keyType: "api-data",
                path: "/social/feed",
                params: { exclude: "none" },
                accountId: account.id,
                pageIndex,
            };
        },
        (key: FeedPageKey) => fetchAPIData<FeedResponse>(key.path, key.params),
        feedSwrOptions,
    );

    const freshPosts = useMemo(() => feedPagePosts(fresh.data), [fresh.data]);
    const caughtUpPosts = useMemo(
        () => feedPagePosts(caughtUp.data),
        [caughtUp.data],
    );
    const posts = useMemo(() => {
        const seen = new Set(freshPosts.map((post) => post.post_id));
        return [
            ...freshPosts,
            ...caughtUpPosts.filter((post) => !seen.has(post.post_id)),
        ];
    }, [freshPosts, caughtUpPosts]);

    const freshLoadingNext = isLoadingNextFeedPage(
        fresh.size,
        fresh.data,
        fresh.isValidating,
    );
    const caughtUpLoadingNext = isLoadingNextFeedPage(
        caughtUp.size,
        caughtUp.data,
        caughtUp.isValidating,
    );

    const hasNextPage = !freshExhausted
        ? feedPageIsFull(fresh.data?.[fresh.data.length - 1])
        : caughtUp.data == null
          ? !caughtUp.error
          : feedPageIsFull(caughtUp.data[caughtUp.data.length - 1]);

    const isLoadingNextPage = !freshExhausted
        ? freshLoadingNext
        : caughtUp.isLoading || caughtUpLoadingNext;

    const loadNextPage = useCallback(async () => {
        if (!hasNextPage || isLoadingNextPage) return;
        if (!freshExhausted) {
            await fresh.setSize((size) => size + 1);
            return;
        }
        await caughtUp.setSize((size) => size + 1);
    }, [
        caughtUp.setSize,
        fresh.setSize,
        freshExhausted,
        hasNextPage,
        isLoadingNextPage,
    ]);

    const refreshFeed = useCallback(async () => {
        await Promise.all([fresh.setSize(1), caughtUp.setSize(1)]);
        await Promise.all([fresh.mutate(), caughtUp.mutate()]);
    }, [caughtUp.mutate, caughtUp.setSize, fresh.mutate, fresh.setSize]);

    return {
        posts,
        /** How many leading posts came from the fresh pages (for the separator). */
        unseenCount: freshPosts.length,
        showingSeen: freshExhausted,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        refreshFeed,
        feedLoading:
            fresh.isLoading ||
            (freshExhausted && caughtUp.isLoading && !caughtUp.data),
        feedErr: fresh.error ?? (freshExhausted ? caughtUp.error : undefined),
    };
}

type NewPostPayload = {
    content: string;
    topic_mk_id?: string | null;
    topic_song_title?: string | null;
    topic_artist_name?: string | null;
    /** Attaches a shared playlist the caller is in, instead of a topic. */
    shared_playlist_id?: number | null;
};

type NewPostResponse = {
    post_id: number;
};

/**
 * Creates a post for the signed-in user. `topic_mk_id` is an optional Apple
 * Music catalog id. Song and artist names go with it so the backend can
 * prefix the embedding without calling Apple. The backend adds the user id
 * from the token. Resolves to the new `post_id`.
 */
export function useCreatePost() {
    const x = useAPIMutation<NewPostPayload, NewPostResponse>(
        "POST",
        "/social/posts",
    );
    return {
        createPostErr: x.error,
        createPostLoading: x.isMutating,
        resetCreatePost: x.reset,
        createPost: async (body: NewPostPayload) =>
            (await x.trigger(body))?.post_id,
    };
}

type DeletePostPayload = {
    post_id: number;
};

function deletePostPath({ post_id }: DeletePostPayload) {
    return `/social/posts/${post_id}`;
}

/**
 * Deletes one of the signed-in user's posts. A missing post, or one they do
 * not own, is a 404. Cache removal is separate: call `useRemoveCachedPost`.
 */
export function useDeletePost() {
    const x = useAPIMutation<DeletePostPayload, void>(
        "DELETE",
        deletePostPath,
        [],
        { invalidation: "none" },
    );
    const deletePost = useCallback(
        (post_id: number) => x.trigger({ post_id }),
        [x.trigger],
    );
    return {
        deletePostErr: x.error,
        deletePostLoading: x.isMutating,
        resetDeletePost: x.reset,
        deletePost,
    };
}

type EditPostPayload = {
    post_id: number;
    content: string;
    /** Client time in milliseconds. Compared with the stored `edited_at`. */
    timestamp: number;
    /** Display names for the embedding prefix. Omitted when the post has no topic. */
    topic_song_title?: string | null;
    topic_artist_name?: string | null;
};

function editPostPath({ post_id }: EditPostPayload) {
    return `/social/posts/${post_id}`;
}

/**
 * Replaces one of the signed-in user's posts. `timestamp` is `Date.now()` when
 * the edit was submitted. The server ignores one older than the stored
 * `edited_at`. Song and artist names go with a topic post so the backend can
 * prefix the new embedding the same way it does on create. A missing post, or
 * one they do not own, is a 404. Cache updates are separate.
 */
export function useUpdatePost() {
    const x = useAPIMutation<EditPostPayload, void>("PATCH", editPostPath, [], {
        invalidation: "none",
    });
    const updatePost = useCallback(
        (
            post_id: number,
            content: string,
            timestamp: number,
            topic?: {
                topic_song_title?: string | null;
                topic_artist_name?: string | null;
            },
        ) => x.trigger({ post_id, content, timestamp, ...topic }),
        [x.trigger],
    );
    return {
        updatePostErr: x.error,
        updatePostLoading: x.isMutating,
        resetUpdatePost: x.reset,
        updatePost,
    };
}

/**
 * Writes new text and `edited_at` through every cached post list, including
 * the infinite feed.
 */
export function useUpdateCachedPostContent() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (postId: number, content: string, editedAt: string | null) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : applyPostContent(current, postId, content, editedAt);
            const writes: Promise<unknown>[] = [
                mutate(isSocialPostListKey, apply, { revalidate: false }),
            ];
            for (const key of cache.keys()) {
                if (!key.startsWith("$inf$")) continue;
                if (!isSocialPostPages(cache.get(key)?.data)) continue;
                writes.push(mutate(key, apply, { revalidate: false }));
            }
            return Promise.all(writes);
        },
        [cache, mutate],
    );
}

/**
 * Drops one post from every cached post list, including the infinite feed.
 * A filtered `mutate` skips `$inf$` keys, so those entries are written by key.
 */
export function useRemoveCachedPost() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (postId: number) => {
            const apply = (current: unknown) =>
                current == null ? current : removePost(current, postId);
            const writes: Promise<unknown>[] = [
                mutate(isSocialPostListKey, apply, { revalidate: false }),
            ];
            for (const key of cache.keys()) {
                if (!key.startsWith("$inf$")) continue;
                if (!isSocialPostPages(cache.get(key)?.data)) continue;
                writes.push(mutate(key, apply, { revalidate: false }));
            }
            return Promise.all(writes);
        },
        [cache, mutate],
    );
}

type MarkPostsViewedPayload = {
    post_ids: number[];
};

/**
 * Marks posts as `viewed` in `post_view_status` (upgrades `loaded`). Does not
 * refresh the feed cache: a mid-scroll refresh would yank rows out from under
 * the user. `/feed` itself writes `loaded` when it returns posts.
 */
export function useMarkPostsViewed() {
    const x = useAPIMutation<MarkPostsViewedPayload, void>(
        "POST",
        "/social/posts/views",
        [],
        { invalidation: "none" },
    );
    const markPostsViewed = useCallback(
        (post_ids: number[]) => {
            const ids = [...new Set(post_ids.filter((id) => id > 0))];
            if (ids.length === 0) return Promise.resolve();
            return x.trigger({ post_ids: ids });
        },
        [x.trigger],
    );
    return {
        markPostsViewedErr: x.error,
        markPostsViewedLoading: x.isMutating,
        resetMarkPostsViewed: x.reset,
        markPostsViewed,
    };
}

type PostLikePayload = {
    post_id: number;
    timestamp: number;
};

function postLikePath({ post_id }: PostLikePayload) {
    return `/social/posts/${post_id}/likes`;
}

/**
 * Likes a post. `timestamp` is `Date.now()` at the click. The service ignores
 * a like or unlike older than the last one it accepted for this user and post.
 */
export function useLikePost() {
    const x = useAPIMutation<PostLikePayload, void>("POST", postLikePath);
    const likePost = useCallback(
        (post_id: number) => x.trigger({ post_id, timestamp: Date.now() }),
        [x.trigger],
    );
    return {
        likePostErr: x.error,
        likePostLoading: x.isMutating,
        resetLikePost: x.reset,
        likePost,
    };
}

/**
 * Writes `liked` through every cached post list. The Discuss page reads that
 * cache again after it unmounts, so a like that lived only on the card would
 * come back on the next visit.
 */
export function useUpdateCachedPostLike() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (postId: number, liked: boolean) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : applyPostLike(current, postId, liked);
            // A filtered mutate skips `$inf$` keys. Topic posts and the feed
            // are both infinite, so those entries are written by key.
            const writes: Promise<unknown>[] = [
                mutate(isSocialPostListKey, apply, { revalidate: false }),
            ];
            for (const key of cache.keys()) {
                if (!key.startsWith("$inf$")) continue;
                if (!isSocialPostPages(cache.get(key)?.data)) continue;
                writes.push(mutate(key, apply, { revalidate: false }));
            }
            return Promise.all(writes);
        },
        [cache, mutate],
    );
}

/** Removes the signed-in user's like. Same `timestamp` rule as `useLikePost`. */
export function useUnlikePost() {
    const x = useAPIMutation<PostLikePayload, void>("DELETE", postLikePath);
    const unlikePost = useCallback(
        (post_id: number) => x.trigger({ post_id, timestamp: Date.now() }),
        [x.trigger],
    );
    return {
        unlikePostErr: x.error,
        unlikePostLoading: x.isMutating,
        resetUnlikePost: x.reset,
        unlikePost,
    };
}

type TopicPostsCursor = {
    likes: number;
    created_at: string;
    post_id: number;
};

type TopicPostsResponse = {
    posts: SocialPost[];
    next: TopicPostsCursor | null;
};

type TopicPageKey = {
    keyType: "api-data";
    path: "/social/posts/topic";
    params: Record<string, string>;
    accountId: string;
};

/**
 * Posts whose topic is this Apple Music catalog id, 10 at a time. Most liked
 * first, then newest, then post id. Pass no id, or `enabled: false`, to leave
 * it unread. The next page sends the previous response's `next` cursor.
 *
 * ```ts
 * const { posts, hasNextPage, loadNextPage } = useTopicPosts(songId, enabled);
 * ```
 */
export function useTopicPosts(topicMkId?: string, enabled = true) {
    const { account } = useAccount();
    const pages = useSWRInfinite<TopicPostsResponse>(
        (pageIndex, previousPage): TopicPageKey | null => {
            if (!account || !enabled || !topicMkId) return null;
            if (pageIndex > 0 && !previousPage?.next) return null;
            const cursor = pageIndex > 0 ? previousPage?.next : null;
            return {
                keyType: "api-data",
                path: "/social/posts/topic",
                params: cursor
                    ? {
                          topic_mk_id: topicMkId,
                          likes: String(cursor.likes),
                          created_at: cursor.created_at,
                          post_id: String(cursor.post_id),
                      }
                    : { topic_mk_id: topicMkId },
                accountId: account.id,
            };
        },
        (key: TopicPageKey) =>
            fetchAPIData<TopicPostsResponse>(key.path, key.params),
        { revalidateFirstPage: false, revalidateAll: false },
    );
    const { data, error, isLoading, isValidating, size, setSize, mutate } =
        pages;
    const posts = useMemo(
        () =>
            uniqueById(
                data,
                (page) => page.posts,
                (post) => post.post_id,
                EMPTY_POSTS,
            ),
        [data],
    );
    const hasNextPage = data?.at(-1)?.next != null;
    const isLoadingNextPage =
        isValidating && Boolean(data?.length) && size > (data?.length ?? 0);
    const loadingNext = useRef(false);
    const loadNextPage = useCallback(async () => {
        if (loadingNext.current) return;
        const loaded = data?.length ?? 0;
        if (error && size > loaded) {
            loadingNext.current = true;
            try {
                await mutate();
            } finally {
                loadingNext.current = false;
            }
            return;
        }
        if (!hasNextPage || isLoadingNextPage) return;
        loadingNext.current = true;
        try {
            await setSize((current) => current + 1);
        } finally {
            loadingNext.current = false;
        }
    }, [
        data?.length,
        error,
        hasNextPage,
        isLoadingNextPage,
        mutate,
        setSize,
        size,
    ]);
    const refreshTopicPosts = useCallback(async () => {
        await setSize(1);
        await mutate();
    }, [mutate, setSize]);

    return {
        posts,
        topicPostsLoading: !data && isLoading,
        topicPostsErr: error,
        refreshTopicPosts,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
    };
}

type UserPostsResponse = {
    profile: SocialUserProfile;
    posts: SocialPost[];
};

/**
 * One author's public profile and their posts, newest first. Pass no id to
 * leave it unread.
 *
 * ```ts
 * const { profile, posts, userPostsLoading, userPostsErr } =
 *     useUserPosts(authorId);
 * ```
 */
const EMPTY_PEOPLE: Friendships["incoming"] = [];
const EMPTY_FRIENDS: Friendships["friends"] = [];

type FriendRequestPayload = {
    user_id: string;
};

/**
 * Sends a friend request to `user_id`. A request already sent is a no-op.
 * An incoming request from them is accepted. Refreshes the profile and the
 * friends list so the button and outgoing requests catch up.
 */
export function useRequestFriend() {
    const { account } = useAccount();
    const x = useAPIMutation<FriendRequestPayload, null>(
        "POST",
        ({ user_id }) => `/social/friends/${user_id}`,
        ({ user_id }) => [
            { path: "/social/friends" },
            { path: `/social/posts/user/${user_id}` },
            ...(account ? [{ path: `/social/posts/user/${account.id}` }] : []),
        ],
    );
    return {
        requestFriendErr: x.error,
        requestFriendLoading: x.isMutating,
        resetRequestFriend: x.reset,
        requestFriend: x.trigger,
    };
}

/**
 * Deletes the friendship row with `user_id`, whatever its status is.
 * Refreshes the friends list, notifications, and both profiles. Ignoring an
 * incoming request marks that notification ignored.
 */
export function useCancelFriendRequest() {
    const { account } = useAccount();
    const x = useAPIMutation<FriendRequestPayload, null>(
        "DELETE",
        ({ user_id }) => `/social/friends/${user_id}`,
        ({ user_id }) => [
            { path: "/social/friends" },
            { path: "/social/notifications" },
            { path: `/social/posts/user/${user_id}` },
            ...(account ? [{ path: `/social/posts/user/${account.id}` }] : []),
        ],
    );
    return {
        cancelFriendRequestErr: x.error,
        cancelFriendRequestLoading: x.isMutating,
        resetCancelFriendRequest: x.reset,
        cancelFriendRequest: x.trigger,
    };
}

/**
 * Accepts an incoming friend request from `user_id`, which completes that
 * friendship. Refreshes the friends list, notifications, and that person's
 * profile. The received-request notification is marked accepted.
 */
export function useAcceptFriendRequest() {
    const { account } = useAccount();
    const x = useAPIMutation<FriendRequestPayload, null>(
        "POST",
        ({ user_id }) => `/social/friends/${user_id}/accept`,
        ({ user_id }) => [
            { path: "/social/friends" },
            { path: "/social/notifications" },
            { path: `/social/posts/user/${user_id}` },
            ...(account ? [{ path: `/social/posts/user/${account.id}` }] : []),
        ],
    );
    return {
        acceptFriendRequestErr: x.error,
        acceptFriendRequestLoading: x.isMutating,
        resetAcceptFriendRequest: x.reset,
        acceptFriendRequest: x.trigger,
    };
}

type UserSearchResponse = {
    users: UserSearchPerson[];
};

const EMPTY_SEARCH: UserSearchPerson[] = [];

/**
 * People whose username contains `search`, other than the signed-in user.
 * `is_friend` is true when they are already friends. A blank search is not fetched.
 *
 * ```ts
 * const { users, userSearchLoading, userSearchErr } = useUserSearch(term);
 * ```
 */
export function useUserSearch(search: string) {
    const term = search.trim();
    const x = useAPIData<UserSearchResponse>(
        "/social/users",
        { search: term },
        { keepPreviousData: true, enabled: term.length > 0 },
    );
    return {
        users: x.data?.users ?? EMPTY_SEARCH,
        userSearchLoading: x.isLoading,
        userSearchErr: x.error,
    };
}

type NotificationCursor = {
    unread: boolean;
    created_at: string;
    notif_id: number;
};

type NotificationsResponse = {
    notifications: SocialNotification[];
    next: NotificationCursor | null;
};

type NotificationPageKey = {
    keyType: "api-data";
    path: "/social/notifications";
    params: Record<string, string>;
    accountId: string;
};

const EMPTY_NOTIFICATIONS: SocialNotification[] = [];

/**
 * The signed-in user's notifications, 20 at a time. Unread first, then newest,
 * with `notif_id` breaking a `created_at` tie. The next page sends the
 * previous response's `next` cursor.
 */
export function useNotifications() {
    const { account } = useAccount();
    const pages = useSWRInfinite<NotificationsResponse>(
        (pageIndex, previousPage): NotificationPageKey | null => {
            if (!account) return null;
            if (pageIndex > 0 && !previousPage?.next) return null;
            const cursor = pageIndex > 0 ? previousPage?.next : null;
            return {
                keyType: "api-data",
                path: "/social/notifications",
                params: cursor
                    ? {
                          unread: String(cursor.unread),
                          created_at: cursor.created_at,
                          notif_id: String(cursor.notif_id),
                      }
                    : {},
                accountId: account.id,
            };
        },
        (key: NotificationPageKey) =>
            fetchAPIData<NotificationsResponse>(key.path, key.params),
        { revalidateFirstPage: false, revalidateAll: false },
    );

    const { data, error, isLoading, isValidating, size, setSize, mutate } =
        pages;
    const notifications = useMemo(
        () =>
            data?.flatMap((page) => page.notifications) ?? EMPTY_NOTIFICATIONS,
        [data],
    );
    const hasNextPage = data?.at(-1)?.next != null;
    const isLoadingNextPage =
        isValidating && Boolean(data?.length) && size > (data?.length ?? 0);
    const loadNextPage = useCallback(async () => {
        if (!hasNextPage || isLoadingNextPage) return;
        await setSize((current) => current + 1);
    }, [hasNextPage, isLoadingNextPage, setSize]);
    const invalidateNotifications = useCallback(() => mutate(), [mutate]);
    const setNotificationResolution = useCallback(
        (notifId: number, resolution: "accepted" | "ignored") =>
            mutate(
                (current) =>
                    current?.map((page) => ({
                        ...page,
                        notifications: page.notifications.map((item) =>
                            item.notif_id === notifId
                                ? {
                                      ...item,
                                      metadata: {
                                          ...item.metadata,
                                          resolution,
                                      },
                                  }
                                : item,
                        ),
                    })),
                { revalidate: false },
            ),
        [mutate],
    );

    const dismissMutation = useAPIMutation<NotificationIdsPayload, void>(
        "POST",
        "/social/notifications/dismiss",
        [],
        { invalidation: "none" },
    );
    const clearMutation = useAPIMutation<void, void>(
        "DELETE",
        "/social/notifications",
        [],
        { invalidation: "none" },
    );
    const dismissTrigger = dismissMutation.trigger;
    const clearTrigger = clearMutation.trigger;
    /**
     * Deletes the given notifications, or every one when `ids` is missing.
     * Drops them from the list first and refetches if the request fails.
     */
    const dismissNotifications = useCallback(
        async (ids?: number[]) => {
            const gone = ids ? new Set(ids) : null;
            await mutate(
                (current) =>
                    current?.map((page) => ({
                        ...page,
                        notifications: gone
                            ? page.notifications.filter(
                                  (item) => !gone.has(item.notif_id),
                              )
                            : [],
                        next: gone ? page.next : null,
                    })),
                { revalidate: false },
            );
            try {
                if (ids) await dismissTrigger({ notif_ids: ids });
                else await clearTrigger();
            } catch (err) {
                void mutate();
                throw err;
            }
        },
        [clearTrigger, dismissTrigger, mutate],
    );

    return {
        notifications,
        notificationsLoading: !data && isLoading,
        notificationsErr: error,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        invalidateNotifications,
        setNotificationResolution,
        dismissNotifications,
    };
}

type NotificationIdsPayload = {
    notif_ids: number[];
};

/**
 * Marks notifications read. Does not refresh `useNotifications`: the list
 * would reorder unread rows while they are on screen. The feed invalidates
 * that cache when it is opened.
 */
export function useMarkNotificationsRead() {
    const x = useAPIMutation<NotificationIdsPayload, void>(
        "POST",
        "/social/notifications/read",
        [],
        { invalidation: "none" },
    );
    const markNotificationsRead = useCallback(
        (notif_ids: number[]) => {
            const ids = [...new Set(notif_ids.filter((id) => id > 0))];
            if (ids.length === 0) return Promise.resolve();
            return x.trigger({ notif_ids: ids });
        },
        [x.trigger],
    );
    return {
        markNotificationsReadErr: x.error,
        markNotificationsReadLoading: x.isMutating,
        resetMarkNotificationsRead: x.reset,
        markNotificationsRead,
    };
}

/** The signed-in user's friends, pending requests, and blocked accounts. */
export function useFriendships() {
    const x = useAPIData<Friendships>("/social/friends");
    return {
        incoming: x.data?.incoming ?? EMPTY_PEOPLE,
        outgoing: x.data?.outgoing ?? EMPTY_PEOPLE,
        friends: x.data?.friends ?? EMPTY_FRIENDS,
        blocked: x.data?.blocked ?? EMPTY_PEOPLE,
        friendshipsLoading: x.isLoading,
        friendshipsErr: x.error,
        reloadFriendships: x.mutate,
    };
}

/**
 * `useFriendships`, refetched the moment a friend comes online or goes
 * offline, through the realtime socket. For screens that show who is online;
 * everything else reads `useFriendships` and skips the subscriptions.
 */
export function useFriendshipsWithPresence() {
    const friendships = useFriendships();
    const { friends, reloadFriendships } = friendships;
    const topics = useMemo<RealtimeTopic[]>(
        () => friends.map((friend) => ({ kind: "user", id: friend.user_id })),
        [friends],
    );
    useRealtimeTopics(topics, (event) => {
        if (event.kind === "presence") void reloadFriendships();
    });
    return friendships;
}

/** Every read a favorite, a block, or an unblock can change. */
function relationTouched(userId: string, accountId: string | undefined) {
    return [
        { path: "/social/friends" },
        { path: "/social/feed" },
        { path: "/social/feed/friends" },
        { path: "/listening/friends" },
        { path: `/social/posts/user/${userId}` },
        ...(accountId ? [{ path: `/social/posts/user/${accountId}` }] : []),
    ];
}

/** Marks or unmarks a friend a favorite, which sorts them first. */
export function useFavoriteFriend() {
    const { account } = useAccount();
    const add = useAPIMutation<FriendRequestPayload, null>(
        "POST",
        ({ user_id }) => `/social/friends/${user_id}/favorite`,
        ({ user_id }) => relationTouched(user_id, account?.id),
    );
    const remove = useAPIMutation<FriendRequestPayload, null>(
        "DELETE",
        ({ user_id }) => `/social/friends/${user_id}/favorite`,
        ({ user_id }) => relationTouched(user_id, account?.id),
    );
    return {
        setFavorite: (user_id: string, favorite: boolean) =>
            (favorite ? add : remove).trigger({ user_id }),
        favoriteLoading: add.isMutating || remove.isMutating,
    };
}

/**
 * Blocks or unblocks `user_id`. A block ends the friendship and hides each
 * one's posts from the other; an unblock does not bring the friendship back.
 */
export function useBlockUser() {
    const { account } = useAccount();
    const block = useAPIMutation<FriendRequestPayload, null>(
        "POST",
        ({ user_id }) => `/social/blocks/${user_id}`,
        ({ user_id }) => relationTouched(user_id, account?.id),
    );
    const unblock = useAPIMutation<FriendRequestPayload, null>(
        "DELETE",
        ({ user_id }) => `/social/blocks/${user_id}`,
        ({ user_id }) => relationTouched(user_id, account?.id),
    );
    return {
        setBlocked: (user_id: string, blocked: boolean) =>
            (blocked ? block : unblock).trigger({ user_id }),
        blockLoading: block.isMutating || unblock.isMutating,
    };
}

/** One post, for opening it from a notification. `null` leaves it unread. */
export function usePost(postId: number | null) {
    const x = useAPIData<SocialPost>(
        `/social/posts/${postId ?? 0}`,
        undefined,
        { enabled: postId != null },
    );
    return {
        post: x.data,
        postLoading: x.isLoading,
        postErr: x.error,
    };
}

export function useUserPosts(authorId?: string) {
    const x = useAPIData<UserPostsResponse>(
        `/social/posts/user/${authorId}`,
        undefined,
        { enabled: Boolean(authorId) },
    );
    return {
        profile: x.data?.profile,
        posts: x.data?.posts ?? EMPTY_POSTS,
        userPostsLoading: x.isLoading,
        userPostsErr: x.error,
    };
}

const EMPTY_REPLIES: SocialReply[] = [];

/**
 * One user's comments, newest first, at most 100, each with the post it
 * answers. Pass no id to leave it unread.
 */
export function useUserReplies(authorId?: string) {
    const x = useAPIData<{ replies: SocialReply[] }>(
        `/social/comments/user/${authorId}`,
        undefined,
        { enabled: Boolean(authorId) },
    );
    return {
        replies: x.data?.replies ?? EMPTY_REPLIES,
        userRepliesLoading: x.isLoading,
        userRepliesErr: x.error,
    };
}

const EMPTY_COMMENTS: SocialComment[] = [];

type CommentsCursor = {
    likes: number;
    created_at: string;
    comment_id: number;
};

type PostCommentsResponse = {
    comments: SocialComment[];
    next: CommentsCursor | null;
};

type CommentPageKey = {
    keyType: "api-data";
    path: string;
    params: Record<string, string>;
    accountId: string;
};

/**
 * Comments on one post, 20 at a time. Most liked first, then newest, then
 * comment id. Pass no id, or `enabled: false`, to leave it unread. The next
 * page sends the previous response's `next` cursor.
 *
 * ```ts
 * const { comments, hasNextPage, loadNextPage } = usePostComments(postId, open);
 * ```
 */
export function usePostComments(postId?: number, enabled = true) {
    const { account } = useAccount();
    const ready = enabled && typeof postId === "number" && postId > 0;
    const pages = useSWRInfinite<PostCommentsResponse>(
        (pageIndex, previousPage): CommentPageKey | null => {
            if (!account || !ready || postId == null) return null;
            if (pageIndex > 0 && !previousPage?.next) return null;
            const cursor = pageIndex > 0 ? previousPage?.next : null;
            return {
                keyType: "api-data",
                path: commentsPath(postId),
                params: cursor
                    ? {
                          likes: String(cursor.likes),
                          created_at: cursor.created_at,
                          comment_id: String(cursor.comment_id),
                      }
                    : {},
                accountId: account.id,
            };
        },
        (key: CommentPageKey) =>
            fetchAPIData<PostCommentsResponse>(key.path, key.params),
        { revalidateFirstPage: false, revalidateAll: false },
    );
    const { data, error, isLoading, isValidating, size, setSize, mutate } =
        pages;
    const comments = useMemo(
        () =>
            uniqueById(
                data,
                (page) => page.comments,
                (comment) => comment.comment_id,
                EMPTY_COMMENTS,
            ),
        [data],
    );
    const hasNextPage = data?.at(-1)?.next != null;
    const isLoadingNextPage =
        isValidating && Boolean(data?.length) && size > (data?.length ?? 0);
    const loadingNext = useRef(false);
    const loadNextPage = useCallback(async () => {
        if (loadingNext.current) return;
        const loaded = data?.length ?? 0;
        if (error && size > loaded) {
            loadingNext.current = true;
            try {
                await mutate();
            } finally {
                loadingNext.current = false;
            }
            return;
        }
        if (!hasNextPage || isLoadingNextPage) return;
        loadingNext.current = true;
        try {
            await setSize((current) => current + 1);
        } finally {
            loadingNext.current = false;
        }
    }, [
        data?.length,
        error,
        hasNextPage,
        isLoadingNextPage,
        mutate,
        setSize,
        size,
    ]);
    const refreshPostComments = useCallback(async () => {
        await setSize(1);
        await mutate();
    }, [mutate, setSize]);
    const { mutate: mutateCached } = useSWRConfig();
    const insertComment = useCallback(
        (comment: SocialComment) => {
            const page = (current: unknown) =>
                current == null
                    ? { comments: [comment], next: null }
                    : insertCachedComment(current, comment);
            return Promise.all([
                // The dialog reads this infinite list, not the separate page keys.
                mutate(
                    (pages) =>
                        (pages && pages.length > 0
                            ? insertCachedComment(pages, comment)
                            : [
                                  { comments: [comment], next: null },
                              ]) as PostCommentsResponse[],
                    { revalidate: false },
                ),
                mutateCached(
                    (key) => isFirstPostCommentsPageKey(key, comment.post_id),
                    page,
                    { revalidate: false },
                ),
            ]);
        },
        [mutate, mutateCached],
    );

    return {
        comments,
        postCommentsLoading: !data && isLoading,
        postCommentsErr: error,
        refreshPostComments,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        insertComment,
    };
}

type NewCommentPayload = {
    post_id: number;
    content: string;
};

type NewCommentResponse = {
    comment_id: number;
};

function createCommentPath({ post_id }: NewCommentPayload) {
    return commentsPath(post_id);
}

/**
 * Creates a comment on a post for the signed-in user. Resolves to the new
 * `comment_id`.
 */
export function useCreateComment() {
    // The dialog inserts the new comment into the cached pages itself. A
    // refetch would replace that page and drop a comment that does not belong
    // on the first page yet.
    const x = useAPIMutation<NewCommentPayload, NewCommentResponse>(
        "POST",
        createCommentPath,
        [],
        { invalidation: "none" },
    );
    return {
        createCommentErr: x.error,
        createCommentLoading: x.isMutating,
        resetCreateComment: x.reset,
        createComment: async (body: NewCommentPayload) =>
            (await x.trigger(body))?.comment_id,
    };
}

type DeleteCommentPayload = {
    comment_id: number;
};

function deleteCommentPath({ comment_id }: DeleteCommentPayload) {
    return `/social/comments/${comment_id}`;
}

type EditCommentPayload = {
    comment_id: number;
    content: string;
    /** Client time in milliseconds. Compared with the stored `edited_at`. */
    timestamp: number;
};

function editCommentPath({ comment_id }: EditCommentPayload) {
    return `/social/comments/${comment_id}`;
}

/**
 * Replaces one of the signed-in user's comments. `timestamp` is `Date.now()`
 * when the edit was submitted. The server ignores one older than the stored
 * `edited_at`. A missing comment, or one they do not own, is a 404. Cache
 * updates are separate.
 */
export function useUpdateComment() {
    const x = useAPIMutation<EditCommentPayload, void>(
        "PATCH",
        editCommentPath,
        [],
        { invalidation: "none" },
    );
    const updateComment = useCallback(
        (comment_id: number, content: string, timestamp: number) =>
            x.trigger({ comment_id, content, timestamp }),
        [x.trigger],
    );
    return {
        updateCommentErr: x.error,
        updateCommentLoading: x.isMutating,
        resetUpdateComment: x.reset,
        updateComment,
    };
}

/** Writes new text and `edited_at` through the cached comments list. */
export function useUpdateCachedCommentContent() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (
            postId: number,
            commentId: number,
            content: string,
            editedAt: string | null,
        ) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : applyCommentContent(
                          current,
                          commentId,
                          content,
                          editedAt,
                      );
            return writeCommentCache(cache, mutate, postId, apply);
        },
        [cache, mutate],
    );
}

/**
 * Deletes one of the signed-in user's comments. A missing comment, or one
 * they do not own, is a 404. The post's comment count drops with it.
 */
export function useDeleteComment() {
    const x = useAPIMutation<DeleteCommentPayload, void>(
        "DELETE",
        deleteCommentPath,
        [],
        { invalidation: "none" },
    );
    const deleteComment = useCallback(
        (comment_id: number) => x.trigger({ comment_id }),
        [x.trigger],
    );
    return {
        deleteCommentErr: x.error,
        deleteCommentLoading: x.isMutating,
        resetDeleteComment: x.reset,
        deleteComment,
    };
}

/** Drops one comment from the cached list for its post. */
export function useRemoveCachedComment() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (postId: number, commentId: number) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : removeCachedComment(current, commentId);
            return writeCommentCache(cache, mutate, postId, apply);
        },
        [cache, mutate],
    );
}

type CommentLikePayload = {
    comment_id: number;
    timestamp: number;
};

function commentLikePath({ comment_id }: CommentLikePayload) {
    return `/social/comments/${comment_id}/likes`;
}

/** Likes a comment. Same `timestamp` rule as post likes. */
export function useLikeComment() {
    const x = useAPIMutation<CommentLikePayload, void>("POST", commentLikePath);
    const likeComment = useCallback(
        (comment_id: number) =>
            x.trigger({ comment_id, timestamp: Date.now() }),
        [x.trigger],
    );
    return {
        likeCommentErr: x.error,
        likeCommentLoading: x.isMutating,
        resetLikeComment: x.reset,
        likeComment,
    };
}

/** Removes the signed-in user's comment like. */
export function useUnlikeComment() {
    const x = useAPIMutation<CommentLikePayload, void>(
        "DELETE",
        commentLikePath,
    );
    const unlikeComment = useCallback(
        (comment_id: number) =>
            x.trigger({ comment_id, timestamp: Date.now() }),
        [x.trigger],
    );
    return {
        unlikeCommentErr: x.error,
        unlikeCommentLoading: x.isMutating,
        resetUnlikeComment: x.reset,
        unlikeComment,
    };
}

/**
 * Writes `liked` through the cached comments list for this post.
 */
export function useUpdateCachedCommentLike() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (postId: number, commentId: number, liked: boolean) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : applyCommentLike(current, commentId, liked);
            return writeCommentCache(cache, mutate, postId, apply);
        },
        [cache, mutate],
    );
}

/** Inserts a comment into the cached list for its post. */
export function useInsertCachedComment() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (comment: SocialComment) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : insertCachedComment(current, comment);
            // Every loaded page matches the comments path. A new comment goes
            // on the first page only, plus the infinite list those pages form.
            const writes: Promise<unknown>[] = [
                mutate(
                    (key) => isFirstPostCommentsPageKey(key, comment.post_id),
                    apply,
                    { revalidate: false },
                ),
            ];
            for (const key of cache.keys()) {
                if (!isInfinitePostCommentsKey(key, comment.post_id)) continue;
                writes.push(mutate(key, apply, { revalidate: false }));
            }
            return Promise.all(writes);
        },
        [cache, mutate],
    );
}

/** Writes one comment change through every page key and the infinite list. */
function writeCommentCache(
    cache: ReturnType<typeof useSWRConfig>["cache"],
    mutate: ReturnType<typeof useSWRConfig>["mutate"],
    postId: number,
    apply: (current: unknown) => unknown,
) {
    const writes: Promise<unknown>[] = [
        mutate((key) => isPostCommentsKey(key, postId), apply, {
            revalidate: false,
        }),
    ];
    for (const key of cache.keys()) {
        if (!isInfinitePostCommentsKey(key, postId)) continue;
        writes.push(mutate(key, apply, { revalidate: false }));
    }
    return Promise.all(writes);
}

/**
 * Moves `comment_count` on one post inside every cached post list.
 * A filtered `mutate` skips `$inf$` keys, and the feed is `useSWRInfinite`,
 * so those entries are written by key when their pages are post lists.
 */
export function useUpdateCachedPostCommentCount() {
    const { cache, mutate } = useSWRConfig();
    return useCallback(
        (postId: number, delta: number) => {
            const apply = (current: unknown) =>
                current == null
                    ? current
                    : applyPostCommentDelta(current, postId, delta);
            // one filtered write answers with a list and each keyed write
            // with one entry, so the array holds either
            const writes: Promise<unknown>[] = [
                mutate(isSocialPostListKey, apply, { revalidate: false }),
            ];
            for (const key of cache.keys()) {
                if (!key.startsWith("$inf$")) continue;
                if (!isSocialPostPages(cache.get(key)?.data)) continue;
                writes.push(mutate(key, apply, { revalidate: false }));
            }
            return Promise.all(writes);
        },
        [cache, mutate],
    );
}
