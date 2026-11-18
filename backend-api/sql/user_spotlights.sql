-- Spotlight posts and the per-user queue that feeds them.
--
-- A spotlight is a shared row in `posts`: null author, empty content, null
-- embeddings, and `topic_mk_id` set to an Apple Music catalog id. One such row
-- exists per catalog id. `user_spotlights` says which of those a user should
-- see. Likes and comments on the shared row are global.
--
-- Additive and idempotent. Drops NOT NULL on two existing columns, adds one
-- partial unique index, one table, and two indexes.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

alter table posts alter column user_id drop not null;
alter table posts alter column embedding drop not null;

-- One shared spotlight post per catalog id. Ordinary posts keep their own rows.
create unique index if not exists posts_spotlight_topic_idx
    on posts (topic_mk_id)
    where user_id is null and topic_mk_id is not null;

create table if not exists user_spotlights (
    user_id uuid not null references auth.users (id) on delete cascade,
    -- `type` in the JSON. The column name stays off the Rust keyword.
    spotlight_type text not null,
    musickit_id text not null,
    post_id bigint not null references posts (post_id) on delete cascade,
    primary key (user_id, spotlight_type, musickit_id),
    constraint user_spotlights_type_chk check (spotlight_type in ('artist', 'song'))
);

create index if not exists user_spotlights_post_id_idx
    on user_spotlights (post_id);

-- Three newest viewed posts for the starting spotlight chance. History pages
-- by `feed_order` (`sql/post_view_status_feed_order.sql`), not by this index.
create index if not exists post_view_status_viewed_idx
    on post_view_status (user_id, date desc, post_id desc)
    where status = 'viewed';

-- Supabase turns row level security on for new tables. The rest of this
-- schema has it off. Left on, any role that is not the owner reads nothing.
alter table user_spotlights disable row level security;
