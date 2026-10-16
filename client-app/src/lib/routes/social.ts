import { useCallback, useMemo } from "react";
import useSWRInfinite from "swr/infinite";

import { useAccount } from "../account";
import {
    fetchAPIData,
    useAPIData,
    useAPIMutation,
    useAPIPostDataBatched,
} from "../api-actions";
import type {
    InterestScoreDelta,
    SocialPost,
    SocialUserProfile,
} from "@/lib/types";

/** Matches social-feed `FEED_SIZE`. A shorter page means this mode is done. */
const FEED_PAGE_SIZE = 10;

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

type FeedPageKey = {
    keyType: "api-data";
    path: "/social/feed";
    params: Record<string, unknown>;
    accountId: string;
    /** Distinguishes pages so each scroll-triggered call hits the network. */
    pageIndex: number;
};

function feedPageIds(pages: FeedResponse[] | undefined): number[] {
    return (pages ?? []).flatMap((page) => page.feed.map(([, id]) => id));
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
 * Ranked post ids for the signed-in user, paged like the library lists.
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

    const freshIds = useMemo(() => feedPageIds(fresh.data), [fresh.data]);
    const caughtUpIds = useMemo(
        () => feedPageIds(caughtUp.data),
        [caughtUp.data],
    );
    const postIds = useMemo(
        () => [...freshIds, ...caughtUpIds],
        [freshIds, caughtUpIds],
    );

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
        postIds,
        /** How many leading ids came from the fresh pages (for the separator). */
        unseenCount: freshIds.length,
        showingSeen: freshExhausted,
        hasNextPage,
        isLoadingNextPage,
        loadNextPage,
        refreshFeed,
        feedLoading:
            fresh.isLoading ||
            (freshExhausted && caughtUp.isLoading && !caughtUp.data),
        feedErr:
            fresh.error ?? (freshExhausted ? caughtUp.error : undefined),
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

type MarkPostsViewedPayload = {
    post_ids: number[];
};

/**
 * Marks posts as `viewed` in `post_view_status` (upgrades `loaded`). Does not
 * refresh the feed cache: a mid-scroll refresh would yank rows out from under
 * the user. `/feed` itself writes `loaded` when it returns ids.
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
