import { useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";

import { useAccount } from "../account";
import { fetchAPIData, useAPIData, useAPIMutation } from "../api-actions";
import {
    applyCommentLike,
    applyPostCommentDelta,
    commentsPath,
    insertCachedComment,
    isPostCommentsKey,
    isSocialPostPages,
} from "../post-comment";
import { applyPostLike, isSocialPostListKey } from "../post-like";
import type {
    InterestScoreDelta,
    SocialComment,
    SocialPost,
    SocialUserProfile,
} from "@/lib/types";

/** Matches the backend feed page size. A shorter page means this mode is done. */
const FEED_PAGE_SIZE = 10;

const EMPTY_POSTS: SocialPost[] = [];

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
    const { mutate } = useSWRConfig();
    return useCallback(
        (postId: number, liked: boolean) =>
            mutate(
                isSocialPostListKey,
                (current: unknown) =>
                    current == null
                        ? current
                        : applyPostLike(current, postId, liked),
                { revalidate: false },
            ),
        [mutate],
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

type TopicPostsResponse = {
    posts: SocialPost[];
};

/**
 * Posts whose topic is this Apple Music catalog id, most liked first.
 * Pass no id, or `enabled: false`, to leave it unread.
 *
 * ```ts
 * const { posts, topicPostsLoading, topicPostsErr, refreshTopicPosts } =
 *     useTopicPosts(songId, enabled);
 * ```
 */
export function useTopicPosts(topicMkId?: string, enabled = true) {
    const x = useAPIData<TopicPostsResponse>(
        "/social/posts/topic",
        topicMkId ? { topic_mk_id: topicMkId } : undefined,
        { enabled: enabled && Boolean(topicMkId) },
    );
    const refreshTopicPosts = useCallback(() => x.mutate(), [x.mutate]);
    return {
        posts: x.data?.posts ?? EMPTY_POSTS,
        topicPostsLoading: x.isLoading,
        topicPostsErr: x.error,
        refreshTopicPosts,
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

const EMPTY_COMMENTS: SocialComment[] = [];

type PostCommentsResponse = {
    comments: SocialComment[];
};

/**
 * Comments on one post, most liked first. Pass no id, or `enabled: false`,
 * to leave it unread.
 *
 * ```ts
 * const { comments, postCommentsLoading } = usePostComments(postId, open);
 * ```
 */
export function usePostComments(postId?: number, enabled = true) {
    const x = useAPIData<PostCommentsResponse>(
        `/social/posts/${postId}/comments`,
        undefined,
        { enabled: enabled && typeof postId === "number" && postId > 0 },
    );
    return {
        comments: x.data?.comments ?? EMPTY_COMMENTS,
        postCommentsLoading: x.isLoading,
        postCommentsErr: x.error,
        refreshPostComments: x.mutate,
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
    const x = useAPIMutation<NewCommentPayload, NewCommentResponse>(
        "POST",
        createCommentPath,
        ({ post_id }) => [{ path: commentsPath(post_id) }],
    );
    return {
        createCommentErr: x.error,
        createCommentLoading: x.isMutating,
        resetCreateComment: x.reset,
        createComment: async (body: NewCommentPayload) =>
            (await x.trigger(body))?.comment_id,
    };
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
    const { mutate } = useSWRConfig();
    return useCallback(
        (postId: number, commentId: number, liked: boolean) =>
            mutate(
                (key) => isPostCommentsKey(key, postId),
                (current: unknown) =>
                    current == null
                        ? current
                        : applyCommentLike(current, commentId, liked),
                { revalidate: false },
            ),
        [mutate],
    );
}

/** Inserts a comment into the cached list for its post. */
export function useInsertCachedComment() {
    const { mutate } = useSWRConfig();
    return useCallback(
        (comment: SocialComment) =>
            mutate(
                (key) => isPostCommentsKey(key, comment.post_id),
                (current: unknown) => insertCachedComment(current, comment),
                { revalidate: false },
            ),
        [mutate],
    );
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
            const writes = [
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
