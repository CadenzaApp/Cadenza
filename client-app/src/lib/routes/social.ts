import { useCallback, useMemo } from "react";

import { useAPIData, useAPIMutation, useAPIPostDataBatched } from "../api-actions";
import type {
    InterestScoreDelta,
    SocialPost,
    SocialUserProfile,
} from "@/lib/types";

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
    feed: [number, number][];
};

/**
 * Ranked post ids for the signed-in user, best first. At most 100.
 * Unseen posts first. If that feed is empty, the same request again with
 * `include_seen_posts` so already viewed posts fill the screen.
 */
export function useFeed() {
    const unseen = useAPIData<FeedResponse>("/social/feed");
    const unseenEmpty = unseen.data?.feed.length === 0;
    const seen = useAPIData<FeedResponse>(
        "/social/feed",
        { include_seen_posts: true },
        { enabled: unseenEmpty },
    );
    const data = unseenEmpty ? seen.data : unseen.data;
    const postIds = useMemo(
        () => (data?.feed ?? []).map((item) => item[1]),
        [data],
    );
    return {
        postIds,
        feedLoading: unseen.isLoading || (unseenEmpty && seen.isLoading),
        feedErr: unseen.error ?? (unseenEmpty ? seen.error : undefined),
    };
}

type NewPostPayload = {
    content: string;
};

type NewPostResponse = {
    post_id: number;
};

/**
 * Creates a post for the signed-in user. The body is only the text. The
 * backend adds the user id from the token. Resolves to the new `post_id`.
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

const POSTS_BATCH_SIZE = 50;

type PostsBatchBody = {
    post_ids: number[];
};

type PostsBatchResponse = {
    posts: SocialPost[];
};

const EMPTY_POSTS: SocialPost[] = [];

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

/**
 * Display fields for many posts at once (content, likes, whether you liked
 * it, created_at, author username), in the order of `postIds`. Missing ids are
 * omitted. The list is split into batches the way other list reads are.
 *
 * ```ts
 * const { posts, postsLoading, postsErr } = usePosts(feedPostIds);
 * ```
 */
export function usePosts(postIds: readonly number[]) {
    const normalizedIds = useMemo(
        () => [...new Set(postIds.filter((id) => Number.isFinite(id)))],
        [postIds],
    );
    const x = useAPIPostDataBatched<
        number,
        PostsBatchBody,
        PostsBatchResponse
    >("/social/posts/batch", normalizedIds, {
        batchSize: POSTS_BATCH_SIZE,
        toBody: (post_ids) => ({ post_ids }),
        merge: (responses) => ({
            posts: responses.flatMap((response) => response.posts),
        }),
    });

    const postsById = useMemo(() => {
        const map = new Map<number, SocialPost>();
        for (const post of x.data?.posts ?? EMPTY_POSTS) {
            map.set(post.post_id, post);
        }
        return map;
    }, [x.data]);

    const posts = useMemo(
        () =>
            normalizedIds
                .map((id) => postsById.get(id))
                .filter((post): post is SocialPost => post != null),
        [normalizedIds, postsById],
    );

    return {
        posts,
        postsById,
        postsLoading: x.isLoading,
        postsErr: x.error,
    };
}
