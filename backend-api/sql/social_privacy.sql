-- Who can see each part of a user's listening. One row per user, created on
-- their first PATCH /settings/privacy. A user with no row reads the column
-- defaults, so a missing row and a row of defaults mean the same thing.
--
-- Additive and idempotent. Creates one type and one table and touches nothing
-- that already exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type audience as enum ('everyone', 'friends', 'nobody');
exception
    when duplicate_object then null;
end
$$;

create table if not exists privacy_settings (
    user_id           uuid primary key references auth.users (id) on delete cascade,
    -- the song playing right now, in now_playing
    now_playing       audience not null default 'friends',
    -- recent plays, read from listening_events
    listening_history audience not null default 'friends',
    -- who can join my live session without a code
    session_join      audience not null default 'friends',
    -- who can add me to a shared playlist directly, without a code
    playlist_add      audience not null default 'friends',
    updated_at        timestamptz not null default now()
);

-- see the note in listening_events.sql
alter table privacy_settings disable row level security;
