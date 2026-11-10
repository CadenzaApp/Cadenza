-- Live sessions: one host plays, members join, queue songs, and control
-- playback as their role allows. Postgres holds the intended state; the
-- realtime hub tells members it changed.
--
-- Playback is an anchor: the current entry, playing or not, and position_ms at
-- server time position_at. Expected position is position_ms plus the time
-- since position_at while playing. See services/live_sessions.rs.
--
-- Not to be confused with listening_events.session_id, which is the client's
-- 30 minute listening sitting.
--
-- Additive and idempotent. Creates three types and three tables.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type session_role as enum ('listener', 'suggester', 'queue_editor', 'controller');
exception
    when duplicate_object then null;
end
$$;

do $$
begin
    create type listen_mode as enum ('remote', 'synced');
exception
    when duplicate_object then null;
end
$$;

do $$
begin
    create type session_entry_status as enum ('suggested', 'queued', 'played', 'rejected');
exception
    when duplicate_object then null;
end
$$;

create table if not exists live_sessions (
    session_id              uuid primary key default gen_random_uuid(),
    host_id                 uuid not null references auth.users (id) on delete cascade,
    name                    text not null check (length(name) between 1 and 100),
    -- what a new member joins as
    default_role            session_role not null default 'suggester',
    -- true lets anyone the host's session_join audience allows join without a
    -- code. false means a code only
    allow_join_without_code boolean not null default true,
    current_entry_id        bigint,
    is_playing              boolean not null default false,
    position_ms             bigint not null default 0,
    position_at             timestamptz not null default now(),
    version                 bigint not null default 1,
    -- the last report from the host's device. 30 minutes without one ends it
    host_seen_at            timestamptz not null default now(),
    created_at              timestamptz not null default now(),
    ended_at                timestamptz
);

-- one open session per host
create unique index if not exists live_sessions_one_open_per_host_idx
    on live_sessions (host_id) where ended_at is null;

create table if not exists live_session_members (
    session_id  uuid not null references live_sessions (session_id) on delete cascade,
    user_id     uuid not null references auth.users (id) on delete cascade,
    role        session_role not null,
    listen_mode listen_mode not null default 'remote',
    joined_at   timestamptz not null default now(),
    left_at     timestamptz,
    -- kicked. a banned member cannot rejoin, code or not
    banned      boolean not null default false,
    primary key (session_id, user_id)
);

create index if not exists live_session_members_user_idx
    on live_session_members (user_id) where left_at is null;

create table if not exists live_session_queue (
    entry_id    bigserial primary key,
    session_id  uuid not null references live_sessions (session_id) on delete cascade,
    -- Apple Music catalog id
    song_id     text not null,
    title       text not null default '',
    artist      text,
    artwork_url text,
    -- needed to project playback forward while the host is backgrounded
    duration_ms bigint,
    -- order among queued entries. suggested, played, and rejected keep theirs
    position    int not null,
    status      session_entry_status not null,
    added_by    uuid references auth.users (id) on delete set null,
    added_at    timestamptz not null default now()
);

create index if not exists live_session_queue_order_idx
    on live_session_queue (session_id, status, position);

-- see the note in listening_events.sql
alter table live_sessions disable row level security;
alter table live_session_members disable row level security;
alter table live_session_queue disable row level security;
