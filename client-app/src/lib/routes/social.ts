import { useMemo } from "react";

import { useAPIMutation, useAPIPostDataBatched } from "../api-actions";
import type { InterestScoreDelta, SocialPost } from "@/lib/types";

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

const POSTS_BATCH_SIZE = 50;

type PostsBatchBody = {
    post_ids: number[];
};

type PostsBatchResponse = {
    posts: SocialPost[];
};

const EMPTY_POSTS: SocialPost[] = [];

/**
 * Display fields for many posts at once (content, likes, created_at, author
 * username), in the order of `postIds`. Missing ids are omitted. The list is
 * split into batches the way other list reads are.
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
