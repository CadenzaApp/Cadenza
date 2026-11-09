-- Queries a user saved from the query results screen, listed under Queries in
-- the Library tab. Private to the user. `query` is the same wire format
-- POST /queries/results takes, and the two flags are the builder settings it
-- ran with, so a saved query reruns exactly as it was saved.
--
-- Additive and idempotent. Creates one table and touches nothing that already
-- exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create table if not exists saved_queries (
    saved_query_id        bigserial primary key,
    user_id               uuid not null references auth.users (id) on delete cascade,
    name                  text not null check (length(btrim(name)) > 0),
    query                 jsonb not null,
    consider_default_tags boolean not null default false,
    library_or_tagged     boolean not null default false,
    created_at            timestamptz not null default now(),
    -- one name per user, so the Queries list never shows two the same
    constraint saved_queries_user_id_name_key unique (user_id, name)
);

alter table saved_queries disable row level security;

-- A saved query holds the songs it matched when it was saved or last rerun,
-- not a live result. Tagging more songs later does not change it unless the
-- user reruns it, or turns on user_settings.auto_update_queries.

-- pinned to the top of the Queries list
alter table saved_queries add column if not exists favorite boolean not null default false;
-- the cover the results screen showed: a json array of up to 4 artwork urls
alter table saved_queries add column if not exists artwork_urls jsonb;
-- when the songs were last stored. Null for a query saved before songs were,
-- whose songs are stored the first time they are read
alter table saved_queries add column if not exists songs_stored_at timestamptz;

create table if not exists saved_query_songs (
    saved_query_id bigint not null references saved_queries (saved_query_id) on delete cascade,
    song_id        text not null,
    -- the song's place in the list, from 0
    position       integer not null,
    -- in the user's library or carrying one of their tags when stored
    certain        boolean not null,
    primary key (saved_query_id, song_id)
);
create index if not exists saved_query_songs_position_idx
    on saved_query_songs (saved_query_id, position);

alter table saved_query_songs disable row level security;

-- when a song is tagged, add it to every saved query it now matches
alter table user_settings
    add column if not exists auto_update_queries boolean not null default false;
