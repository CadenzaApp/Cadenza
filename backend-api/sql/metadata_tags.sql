-- Metadata tags: a copy of each song's Apple Music catalog metadata, and the
-- album crawl queue that fills it in a whole album at a time. See
-- src/services/metadata_tags.rs.
--
-- Not authoritative. Apple Music still owns song metadata. These rows exist so a query can
-- filter on artist, album, genre, release date, length, and rating, and so a song's
-- Metadata Tags show what those queries match on. Nothing else reads them.
--
-- Additive. Creates one type, two tables, and their indexes, and touches nothing that
-- already exists. Idempotent, so running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type metadata_crawl_status as enum ('pending', 'in_flight', 'done', 'failed');
exception
    when duplicate_object then null;
end
$$;

-- one row per song any user has seen, opened, or has in their library, plus every song on
-- a crawled album
create table if not exists metadata_song_tags_applied (
    song_id            text primary key,
    -- false when Apple has no catalog entry for the id, so it is never asked again. every
    -- metadata column below is null then
    found              boolean not null,
    name               text,
    artist_name        text,
    album_name         text,
    -- what the album crawl keys on. not offered to queries
    album_id           text,
    duration_in_millis integer,
    -- without Apple's catch-all "Music" genre
    genre_names        text[] not null default '{}',
    -- Apple sometimes knows only the year. that is stored as January 1
    release_date       date,
    -- 'explicit', 'clean', or null when Apple gave no rating
    content_rating     text,
    fetched_at         timestamptz not null default now()
);

-- "starts with" on the text fields, for when queries run over more than one library
create index if not exists metadata_song_tags_applied_name_idx
    on metadata_song_tags_applied (lower(name) text_pattern_ops);
create index if not exists metadata_song_tags_applied_artist_name_idx
    on metadata_song_tags_applied (lower(artist_name) text_pattern_ops);
create index if not exists metadata_song_tags_applied_album_name_idx
    on metadata_song_tags_applied (lower(album_name) text_pattern_ops);
create index if not exists metadata_song_tags_applied_album_id_idx
    on metadata_song_tags_applied (album_id);
create index if not exists metadata_song_tags_applied_release_date_idx
    on metadata_song_tags_applied (release_date);
create index if not exists metadata_song_tags_applied_duration_idx
    on metadata_song_tags_applied (duration_in_millis);
create index if not exists metadata_song_tags_applied_genre_names_idx
    on metadata_song_tags_applied using gin (genre_names);

-- the album crawl's state, which is also its work queue
create table if not exists metadata_albums (
    album_id   text primary key,
    status     metadata_crawl_status not null default 'pending',
    -- counted when the crawl claims the album. at 5 a failure marks it 'failed'
    attempts   integer not null default 0,
    queued_at  timestamptz not null default now(),
    -- set when the album is marked 'done'
    crawled_at timestamptz
);

-- what the crawl claims from, oldest first
create index if not exists metadata_albums_pending_idx
    on metadata_albums (queued_at)
    where status = 'pending';

-- Supabase turns row level security on for new tables by default. Every other table in
-- this schema has it off, and the api connects as the owner. See sql/listening_events.sql.
alter table metadata_song_tags_applied disable row level security;
alter table metadata_albums disable row level security;
