-- A post can attach one shared playlist, instead of an Apple Music song or
-- artist in topic_mk_id. The feed shows its name, cover, song count, and
-- member count to everyone who sees the post. Opening it still needs
-- membership or a code.
--
-- shared_playlist_id is not a foreign key. Deleting the playlist leaves the
-- id on the post, and the feed shows that attachment as unavailable.
--
-- Additive and idempotent. Adds one nullable column and one check to posts,
-- and drops the foreign key if an earlier apply added it.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

alter table posts
    add column if not exists shared_playlist_id bigint;

alter table posts
    drop constraint if exists posts_shared_playlist_id_fkey;

do $$
begin
    alter table posts add constraint posts_one_topic_chk
        check (topic_mk_id is null or shared_playlist_id is null);
exception
    when duplicate_object then null;
end
$$;
