/**
 * The optimistic update a comment vote makes to cached comment threads. Only
 * type imports, so it can be unit tested without pulling in React Native.
 */

import type { Comment, CommentThread, CommentVote } from "@/lib/types";

/** A vote's share of a comment's score: 1 for up, -1 for down, 0 for none. */
function scoreOf(vote: CommentVote | null) {
    return vote === "up" ? 1 : vote === "down" ? -1 : 0;
}

/** The comment with the user's vote swapped for `vote`, and its score moved to match. */
function withVote<T extends Comment>(comment: T, vote: CommentVote | null): T {
    return {
        ...comment,
        my_vote: vote,
        votes: comment.votes - scoreOf(comment.my_vote) + scoreOf(vote),
    };
}

/**
 * Returns the threads with the user's vote on one comment, top level or reply,
 * set to `vote`, which is null to take the vote back. Threads without that
 * comment come back as the same objects.
 */
export function applyCommentVote(
    threads: CommentThread[],
    commentId: number,
    vote: CommentVote | null,
): CommentThread[] {
    return threads.map((thread) => {
        if (thread.id === commentId) return withVote(thread, vote);
        if (!thread.replies.some((reply) => reply.id === commentId)) {
            return thread;
        }
        return {
            ...thread,
            replies: thread.replies.map((reply) =>
                reply.id === commentId ? withVote(reply, vote) : reply,
            ),
        };
    });
}
