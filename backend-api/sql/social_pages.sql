-- Page order for topic posts and post comments.
--
-- Additive. Creates two indexes and touches nothing that already exists.
-- Idempotent, so running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

-- GET /social/posts/topic reads one catalog id, most liked first, then newest,
-- then post id, 10 at a time. Rows with no topic stay out of the index.
create index if not exists posts_topic_likes_idx
    on posts (topic_mk_id, likes desc, created_at desc, post_id desc)
    where topic_mk_id is not null;

-- GET /social/posts/:id/comments reads one post, most liked first, then newest,
-- then comment id, 20 at a time.
create index if not exists comments_post_likes_idx
    on comments (post_id, likes desc, created_at desc, comment_id desc);
