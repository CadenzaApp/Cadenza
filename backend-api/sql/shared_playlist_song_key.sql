-- A shared playlist holds each catalog song once. The row's key is
-- (playlist_id, song_id). entry_id goes away.
--
-- Keeps the earliest copy when a song was in twice, then renumbers.
-- A database that already has the new key is left alone.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'shared_playlist_songs'
          and column_name = 'entry_id'
    ) then
        delete from shared_playlist_songs s
        using (
            select entry_id
            from (
                select entry_id,
                       row_number() over (
                           partition by playlist_id, song_id
                           order by position, entry_id
                       ) as rn
                from shared_playlist_songs
            ) ranked
            where rn > 1
        ) dupes
        where s.entry_id = dupes.entry_id;

        alter table shared_playlist_songs drop constraint shared_playlist_songs_pkey;
        alter table shared_playlist_songs drop column entry_id;
        alter table shared_playlist_songs
            add primary key (playlist_id, song_id);

        update shared_playlist_songs s
        set position = r.rn - 1
        from (
            select playlist_id, song_id,
                   row_number() over (
                       partition by playlist_id
                       order by position, song_id
                   ) as rn
            from shared_playlist_songs
        ) r
        where s.playlist_id = r.playlist_id
          and s.song_id = r.song_id
          and s.position <> r.rn - 1;
    end if;
end
$$;
