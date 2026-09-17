import { useAPIData, useAPIMutation } from "../api-actions";
import { applyCommentVote } from "../comment-votes";
import type { Comment, CommentThread, CommentVote } from "@/lib/types";

/** Every user's comments on a song: newest first, each with its replies oldest first. */
export function useSongComments(songId?: string) {
    const x = useAPIData<CommentThread[]>("/comments", {
        song_id: songId,
    });

    return {
        songComments: x.data,
        songCommentsLoading: x.isLoading,
        songCommentsErr: x.error,
    };
}

type NewCommentPayload = {
    song_id: string;
    content: string;
    /** the top level comment on the same song this one replies to */
    parent_id?: number;
};
/** Leaves a comment on a song, or a reply when `parent_id` is set. Resolves to the new comment. */
export function useCreateComment() {
    const x = useAPIMutation<NewCommentPayload, Comment>(
        "POST",
        "/comments",
        ({ song_id }) => [{ path: "/comments", params: { song_id } }],
    );
    return {
        createCommentErr: x.error,
        createCommentLoading: x.isMutating,
        resetCreateComment: x.reset,
        createComment: x.trigger,
    };
}

/** Deletes one of the user's comments, and every reply to it. */
export function useDeleteComment() {
    // the payload has no song id, so every song's comments revalidate
    const x = useAPIMutation<{ comment_id: number }, void>(
        "DELETE",
        "/comments",
        [{ path: "/comments" }],
    );
    return {
        deleteCommentErr: x.error,
        deleteCommentLoading: x.isMutating,
        resetDeleteComment: x.reset,
        deleteComment: x.trigger,
    };
}

type VotePayload = {
    comment_id: number;
    /** null takes the user's vote back */
    vote: CommentVote | null;
};
/**
 * Sets or takes back the user's vote on one of a song's comments. Shows the
 * vote in that song's cached comments straight away, rolls it back if the
 * request fails, and revalidates the comments either way.
 */
export function useVoteOnComment(songId?: string) {
    const comments = useAPIData<CommentThread[]>("/comments", {
        song_id: songId,
    });
    // lists nothing to invalidate, since the mutate below revalidates the comments
    const x = useAPIMutation<VotePayload, void>("POST", "/comments/votes");

    async function voteOnComment(commentId: number, vote: CommentVote | null) {
        await comments.mutate(
            async (current) => {
                await x.trigger({ comment_id: commentId, vote });
                return current && applyCommentVote(current, commentId, vote);
            },
            {
                optimisticData: (current) =>
                    applyCommentVote(current ?? [], commentId, vote),
                rollbackOnError: true,
                revalidate: true,
            },
        );
    }

    return {
        voteOnCommentErr: x.error,
        voteOnComment,
    };
}
