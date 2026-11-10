-- Shared playlists: Cadenza owned playlists several users edit together. Apple
-- Music never sees them, apart from "save a copy", which is a one off write.
--
-- Every write locks the playlist row, checks the caller's role, renumbers
-- positions, and bumps version, in one transaction. See db/shared_playlists.rs.
--
-- Additive and idempotent. Creates one type and three tables.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type playlist_role as enum ('owner', 'editor', 'viewer');
exception
    when duplicate_object then null;
end
$$;

create table if not exists shared_playlists (
    playlist_id bigserial primary key,
    owner_id    uuid not null references auth.users (id) on delete cascade,
    name        text not null check (length(name) between 1 and 100),
    description text not null default '' check (length(description) <= 500),
    -- bumped by every write, so a client that sees a gap refetches
    version     bigint not null default 1,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists shared_playlist_members (
    playlist_id bigint not null references shared_playlists (playlist_id) on delete cascade,
    user_id     uuid not null references auth.users (id) on delete cascade,
    role        playlist_role not null,
    joined_at   timestamptz not null default now(),
    primary key (playlist_id, user_id)
);

-- "my shared playlists"
create index if not exists shared_playlist_members_user_idx
    on shared_playlist_members (user_id);

create table if not exists shared_playlist_songs (
    -- its own id, so the same song can be in twice and a move or remove
    -- targets one entry
    entry_id    bigserial primary key,
    playlist_id bigint not null references shared_playlists (playlist_id) on delete cascade,
    -- Apple Music catalog id. A library id means nothing to other members
    song_id     text not null,
    position    int not null,
    added_by    uuid references auth.users (id) on delete set null,
    added_at    timestamptz not null default now()
);

create index if not exists shared_playlist_songs_order_idx
    on shared_playlist_songs (playlist_id, position);

-- see the note in listening_events.sql
alter table shared_playlists disable row level security;
alter table shared_playlist_members disable row level security;
alter table shared_playlist_songs disable row level security;
