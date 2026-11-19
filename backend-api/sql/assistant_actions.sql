-- The assistant's activity log: one row per change the user confirmed in the
-- assistant (tags, saved queries, shared playlists, Apple Music playlist adds).
-- `changes` holds exactly what the change did, enough to reverse it, so Undo
-- touches nothing the change did not. A change Cadenza cannot reverse (adding
-- to an Apple Music playlist) is logged with `undoable` false.
--
-- Each user keeps the last 30 days, and at most 100 rows; older ones are
-- pruned when a new one is written.
--
-- Additive and idempotent. Creates one table and touches nothing that already
-- exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create table if not exists assistant_actions (
    action_id   bigserial primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    created_at  timestamptz not null default now(),
    -- apply_tag, remove_tag, create_tag, update_tag, save_query,
    -- rename_saved_query, edit_shared_playlist, update_shared_playlist,
    -- add_to_apple_music_playlist, create_apple_music_playlist
    kind        text not null,
    -- the row's text, like "Applied pop to 1,156 songs"
    summary     text not null,
    -- what it changed: tag, saved_query, shared_playlist, or apple_music_playlist
    target_kind text,
    target_id   text,
    target_name text,
    changes     jsonb not null default '{}'::jsonb,
    undoable    boolean not null,
    undone_at   timestamptz,
    -- what Undo did, like "Left 2 songs you changed since"
    undo_result text
);

create index if not exists assistant_actions_user_created_idx
    on assistant_actions (user_id, created_at desc);

alter table assistant_actions disable row level security;
