import assert from "node:assert/strict";
import test from "node:test";

import {
    applyCommentVote,
    orderThreadsLike,
    sortThreadsByVotes,
} from "./comment-votes.ts";
import type { Comment, CommentThread } from "./types.ts";

function comment(
    id: number,
    votes = 0,
    my_vote: Comment["my_vote"] = null,
): Comment {
    return {
        id,
        content: `comment ${id}`,
        created_at: "2026-09-15T18:03:11.482913Z",
        mine: false,
        votes,
        my_vote,
    };
}

function thread(top: Comment, replies: Comment[] = []): CommentThread {
    return { ...top, replies };
}

test("a new vote moves the score by one", () => {
    const [up] = applyCommentVote([thread(comment(1, 3))], 1, "up");
    assert.equal(up.votes, 4);
    assert.equal(up.my_vote, "up");

    const [down] = applyCommentVote([thread(comment(1, 3))], 1, "down");
    assert.equal(down.votes, 2);
    assert.equal(down.my_vote, "down");
});

test("switching a vote moves the score by two, and taking it back undoes it", () => {
    const [switched] = applyCommentVote([thread(comment(1, 4, "up"))], 1, "down");
    assert.equal(switched.votes, 2);
    assert.equal(switched.my_vote, "down");

    const [cleared] = applyCommentVote([thread(comment(1, 4, "up"))], 1, null);
    assert.equal(cleared.votes, 3);
    assert.equal(cleared.my_vote, null);
});

test("a vote on a reply changes only that reply", () => {
    const threads = [
        thread(comment(1, 5), [comment(2), comment(3, 1, "up")]),
        thread(comment(4)),
    ];

    const [voted, untouched] = applyCommentVote(threads, 3, "down");

    assert.deepEqual(
        voted,
        thread(comment(1, 5), [comment(2), comment(3, -1, "down")]),
    );
    assert.equal(untouched, threads[1]);
});

test("a vote on a comment that isn't cached leaves every thread alone", () => {
    const threads = [thread(comment(1), [comment(2)])];

    const [unchanged] = applyCommentVote(threads, 99, "up");

    assert.equal(unchanged, threads[0]);
});

test("threads sort by score, newest first among equal scores", () => {
    const threads = [
        thread(comment(4, 0)),
        thread(comment(3, 2)),
        thread(comment(2, -1)),
        thread(comment(1, 2)),
    ];

    const sorted = sortThreadsByVotes(threads);

    assert.deepEqual(
        sorted.map(({ id }) => id),
        [3, 1, 4, 2],
    );
    // the cached array keeps its order
    assert.deepEqual(
        threads.map(({ id }) => id),
        [4, 3, 2, 1],
    );
});

test("sorting threads leaves the order of their replies alone", () => {
    const replies = [comment(3), comment(4, 9), comment(5, -2)];

    const [sorted] = sortThreadsByVotes([thread(comment(1), replies)]);

    assert.equal(sorted.replies, replies);
});

test("a held order keeps each thread in place after its score changes", () => {
    // sorted by score this would be 2, 3, 1
    const threads = [
        thread(comment(3, 0)),
        thread(comment(2, 7)),
        thread(comment(1, -4)),
    ];

    assert.deepEqual(
        orderThreadsLike(threads, [3, 1, 2]).map(({ id }) => id),
        [3, 1, 2],
    );
});

test("a held order puts new threads first, newest first, and skips deleted ones", () => {
    // 5 and 6 were posted after the order was taken, and 3 was deleted
    const threads = [
        thread(comment(5)),
        thread(comment(1)),
        thread(comment(6)),
        thread(comment(2, 3)),
    ];

    assert.deepEqual(
        orderThreadsLike(threads, [1, 3, 2]).map(({ id }) => id),
        [6, 5, 1, 2],
    );
});
