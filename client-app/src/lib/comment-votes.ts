/**
 * How votes shape comment threads: the optimistic update a vote makes to cached
 * threads, and the order the Comments page shows them in. Only type imports, so
 * it can be unit tested without pulling in React Native.
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

/**
 * Returns a copy of the threads, highest score first, and newest first among
 * equal scores. Comment ids only grow, so a higher id is a newer comment.
 * Replies keep the order they came in.
 */
export function sortThreadsByVotes(threads: CommentThread[]): CommentThread[] {
    return [...threads].sort((a, b) => b.votes - a.votes || b.id - a.id);
}

/**
 * Returns the threads in the order of `ids`, the thread ids from an earlier
 * sort. Threads missing from `ids`, like a comment posted since, come first,
 * newest first. Ids with no thread left, like a deleted comment, are skipped.
 */
export function orderThreadsLike(
    threads: CommentThread[],
    ids: number[],
): CommentThread[] {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const ordered = new Set(ids);
    const added = threads
        .filter(({ id }) => !ordered.has(id))
        .sort((a, b) => b.id - a.id);
    return [...added, ...ids.flatMap((id) => byId.get(id) ?? [])];
}
