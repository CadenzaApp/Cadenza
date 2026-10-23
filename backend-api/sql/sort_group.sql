-- Sort and group: where each metadata_song_tags_applied row came from. See
-- src/db/metadata_tags.rs and the query compiler in src/db/queries.rs.
--
-- 'catalog' rows are what Apple's catalog said about the song. 'library' rows are what a
-- phone said about a song only its library knows: an uploaded song, or one Apple has not
-- matched to the catalog, which has a library id like "i.abc123" and no catalog entry. A
-- song list sorts and groups by these rows, so a song like that still has a title, artist
-- and the rest to sort on.
--
-- A 'library' row is one user's own song, never a song another user's query discovers, so
-- the query compiler only discovers 'catalog' rows.
--
-- Additive and idempotent. Adds a column with a default, so every existing row reads as
-- 'catalog', which it is.
--
-- Applied by hand against Supabase, the same way the rest of this schema was. Every query
-- fails until it is, because the compiler reads the column.

alter table metadata_song_tags_applied
    add column if not exists source text not null default 'catalog';

do $$
begin
    alter table metadata_song_tags_applied
        add constraint metadata_song_tags_applied_source_check
        check (source in ('catalog', 'library'));
exception
    when duplicate_object then null;
end
$$;

-- The song's artwork, so a sorted list can draw its rows from these rows alone, without
-- asking Apple for every song first. A real url, already sized. Null for a row stored before
-- this column, which the next sorted list it shows up in fills in on its own task, and empty
-- for a song Apple has no artwork for.
alter table metadata_song_tags_applied
    add column if not exists artwork_url text;
