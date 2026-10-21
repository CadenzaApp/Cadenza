import assert from "node:assert/strict";
import test from "node:test";

import {
    applyCommentLike,
    applyPostCommentDelta,
    commentsPath,
    insertCachedComment,
    isPostCommentsKey,
    isSocialPostPages,
    pinComments,
    sortCommentsByLikes,
} from "./post-comment.ts";

const comment = {
    comment_id: 2,
    post_id: 4,
    content: "hi",
    likes: 3,
    liked: false,
    created_at: "2026-10-16T18:00:00Z",
    author: { user_id: "u", username: "ada" },
};

test("commentsPath is the post comments endpoint", () => {
    assert.equal(commentsPath(4), "/social/posts/4/comments");
    assert.equal(isPostCommentsKey({ path: commentsPath(4) }, 4), true);
    assert.equal(isPostCommentsKey({ path: commentsPath(4) }, 9), false);
    assert.equal(isPostCommentsKey({ path: "/social/feed" }), false);
});

test("sorts by likes desc, then newest", () => {
    const older = {
        ...comment,
        comment_id: 1,
        likes: 1,
        created_at: "2026-10-16T17:00:00Z",
    };
    const newerSameLikes = {
        ...comment,
        comment_id: 3,
        likes: 1,
        created_at: "2026-10-16T19:00:00Z",
    };
    const sorted = sortCommentsByLikes([older, comment, newerSameLikes]);
    assert.deepEqual(
        sorted.map((row) => row.comment_id),
        [2, 3, 1],
    );
});

test("liking a cached comment bumps likes and re-sorts", () => {
    const other = { ...comment, comment_id: 8, likes: 3, liked: false };
    const cached = { comments: [comment, other] };
    const next = applyCommentLike(cached, 8, true) as typeof cached;
    assert.equal(next.comments[0].comment_id, 8);
    assert.equal(next.comments[0].liked, true);
    assert.equal(next.comments[0].likes, 4);
    assert.equal(next.comments[1].comment_id, 2);
});

test("inserting a comment appends and sorts", () => {
    const cached = { comments: [comment] };
    const added = {
        ...comment,
        comment_id: 9,
        likes: 0,
        created_at: "2026-10-16T20:00:00Z",
    };
    const next = insertCachedComment(cached, added) as typeof cached;
    assert.equal(next.comments[0].comment_id, 2);
    assert.equal(next.comments[1].comment_id, 9);
    assert.equal(insertCachedComment(next, added), next);
});

test("pinned comments stay first and the rest keep their order", () => {
    const older = { ...comment, comment_id: 1, likes: 9 };
    const newer = { ...comment, comment_id: 9, likes: 0 };
    const rows = [older, comment, newer];
    const pinned = pinComments(rows, [9, 2]);
    assert.deepEqual(
        pinned.map((row) => row.comment_id),
        [9, 2, 1],
    );
    assert.equal(pinComments(rows, []), rows);
    assert.equal(pinComments(rows, [99]), rows);
});

test("infinite post pages are feed or profile pages, not other lists", () => {
    const post = { post_id: 4, comment_count: 1 };
    assert.equal(isSocialPostPages([{ feed: [post] }]), true);
    assert.equal(isSocialPostPages([{ posts: [post] }, { posts: [] }]), true);
    assert.equal(isSocialPostPages([]), false);
    assert.equal(isSocialPostPages({ feed: [post] }), false);
    assert.equal(isSocialPostPages([{ items: [{ id: "song" }] }]), false);
    assert.equal(isSocialPostPages([[{ id: "song" }]]), false);
    assert.equal(
        isSocialPostPages([{ feed: [{ title: "not a post" }] }]),
        false,
    );
});

test("comment count delta updates feed and profile caches", () => {
    const post = {
        post_id: 4,
        content: "hi",
        likes: 0,
        liked: false,
        created_at: "2026-10-16T18:00:00Z",
        author: { user_id: "u", username: "ada" },
        topic_mk_id: null,
        comment_count: 1,
    };
    const feed = applyPostCommentDelta({ feed: [post] }, 4, 1) as {
        feed: (typeof post)[];
    };
    assert.equal(feed.feed[0].comment_count, 2);
    const pages = applyPostCommentDelta([{ posts: [post] }], 4, -1) as {
        posts: (typeof post)[];
    }[];
    assert.equal(pages[0].posts[0].comment_count, 0);
});
