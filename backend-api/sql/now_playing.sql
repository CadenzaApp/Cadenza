-- What each user is playing right now. Current state, one row per user,
-- overwritten by PUT /listening/now-playing. History is listening_events.
--
-- A row is shown as playing only while is_playing and the song would not have
-- ended a minute ago, projected from the position anchor. So a phone that dies
-- mid song stops showing within a song's length, and no cleanup job is needed.
--
-- Additive and idempotent. Creates one table and touches nothing that already
-- exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create table if not exists now_playing (
    user_id         uuid primary key references auth.users (id) on delete cascade,
    -- Apple Music catalog id. A library id means nothing on another account
    song_id         text not null,
    title           text not null,
    artist          text,
    album           text,
    artwork_url     text,
    -- null when the player did not know the length yet
    duration_ms     bigint,
    is_playing      boolean not null,
    -- position_ms was the position at position_at, our clock
    position_ms     bigint not null,
    position_at     timestamptz not null,
    -- the live session this play belongs to, once live sessions exist
    live_session_id uuid,
    updated_at      timestamptz not null default now()
);

-- see the note in listening_events.sql
alter table now_playing disable row level security;
