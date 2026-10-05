-- The listening event log. Append only: one row per thing a user did while
-- listening. Everything in src/services/analytics/ aggregates from here.
--
-- Additive. Creates one table and its indexes and touches nothing that already
-- exists, so it is safe to run against a database with data in it. Idempotent,
-- so running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.
-- Kept here so a fresh database can be stood up and so changes are reviewable.

create table if not exists listening_events (
    event_id        bigserial primary key,
    user_id         uuid not null references auth.users (id) on delete cascade,
    -- validated in rust by services::analytics::EventType, not by the database,
    -- so a new event type costs a deploy and not a schema change
    event_type      text not null,
    -- null for events that are not about one song, like query_run
    song_id         text,
    -- the client's clock, which is what the user experienced
    occurred_at     timestamptz not null,
    -- our clock, for debugging a client whose clock is wrong
    created_at      timestamptz not null default now(),
    -- iana name, e.g. America/Denver. an offset would be wrong across dst, and
    -- storing it per event keeps old buckets right after the user moves
    client_tz       text not null default 'UTC',
    -- one listening sitting. lets "played it 6 times in a row" be a group by
    session_id      uuid,
    -- per user idempotency key, so a retried batch inserts nothing
    client_event_id text not null,
    -- per event type, and read by the aggregates, so not just decoration:
    --   play_counted   artist_name, artist_id, album_name, album_id
    --   play_complete  listened_ms, duration_ms
    --   skip           listened_ms, position_ms, duration_ms
    --   seek           from_ms, to_ms, position_ms
    --   query_run      result_count
    --   query_play     result_count
    --   tag_applied    tag_name
    -- artist_name and album_name are the group keys for the artist and album
    -- rankings. Numbers must be whole: the aggregates cast them to bigint.
    payload         jsonb not null default '{}'::jsonb
);

-- what makes ON CONFLICT DO NOTHING work on re-send
create unique index if not exists listening_events_idempotency_idx
    on listening_events (user_id, client_event_id);

-- every window read: this user, this time range
create index if not exists listening_events_user_time_idx
    on listening_events (user_id, occurred_at desc);

-- the same, narrowed to one event type, which is most summary stats
create index if not exists listening_events_user_type_time_idx
    on listening_events (user_id, event_type, occurred_at desc);

-- per song drilldowns and the top songs list
create index if not exists listening_events_user_song_idx
    on listening_events (user_id, song_id, occurred_at desc)
    where song_id is not null;

-- session rollups, for replays in one sitting
create index if not exists listening_events_session_idx
    on listening_events (user_id, session_id)
    where session_id is not null;

-- Supabase turns row level security on for new tables by default. Every other
-- table in this schema has it off, and the api connects as the owner, which
-- bypasses it anyway. Left on it would silently return nothing to any other
-- role, so match the rest of the schema instead of being the one exception.
alter table listening_events disable row level security;
