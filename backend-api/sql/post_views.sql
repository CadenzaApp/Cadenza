-- One row per user who has viewed a post. Composite pk of (post_id, user_id),
-- so a second view of the same post is a no-op. The social feed sources skip
-- posts the user already has a row for.
--
-- Additive. Creates one table and touches nothing that already exists.
-- Idempotent, so running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.
-- Kept here so a fresh database can be stood up and so changes are reviewable.

create table if not exists post_views (
    post_id bigint not null references posts (post_id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    date    timestamptz not null default now(),
    primary key (post_id, user_id)
);

-- Supabase turns row level security on for new tables by default. Every other
-- table in this schema has it off, so the api role can read and write normally.
alter table post_views disable row level security;
