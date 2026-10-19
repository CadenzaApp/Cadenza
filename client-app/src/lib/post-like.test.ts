import assert from "node:assert/strict";
import test from "node:test";

import { applyPostLike, isSocialPostListKey } from "./post-like.ts";

const likedPost = {
    post_id: 4,
    content: "hi",
    likes: 3,
    liked: true,
    created_at: "2026-10-16T18:00:00Z",
    author: { user_id: "u", username: "ada" },
    topic_mk_id: "song",
};

test("topic, profile, and feed caches are post lists", () => {
    assert.equal(isSocialPostListKey({ path: "/social/posts/topic" }), true);
    assert.equal(isSocialPostListKey({ path: "/social/posts/user/abc" }), true);
    assert.equal(isSocialPostListKey({ path: "/social/feed" }), true);
    assert.equal(isSocialPostListKey({ path: "/social/posts" }), false);
    assert.equal(isSocialPostListKey("$inf$/social/feed"), false);
});

test("unliking a cached post clears liked and drops the count", () => {
    const cached = { posts: [likedPost, { ...likedPost, post_id: 9 }] };
    const next = applyPostLike(cached, 4, false) as typeof cached;
    assert.equal(next.posts[0].liked, false);
    assert.equal(next.posts[0].likes, 2);
    assert.equal(next.posts[1], cached.posts[1]);
});

test("writing the same liked value does not count twice", () => {
    const cached = { posts: [{ ...likedPost, liked: false, likes: 2 }] };
    assert.equal(applyPostLike(cached, 4, false), cached);
});

test("a feed page and an infinite list of pages both update", () => {
    const page = { feed: [likedPost] };
    const next = applyPostLike([page], 4, false) as (typeof page)[];
    assert.equal(next[0].feed[0].liked, false);
    assert.equal(next[0].feed[0].likes, 2);
});
