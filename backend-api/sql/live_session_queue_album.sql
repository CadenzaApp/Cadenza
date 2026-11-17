-- live_session_queue.album, album_id, artist_id: what the app knows about a
-- session song beyond its title and artist, so a play inside a session is
-- logged with its album and ids, the way the most listened artist and album
-- rankings group plays. Null for a song added without them.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_session_queue add column if not exists album text;
alter table live_session_queue add column if not exists album_id text;
alter table live_session_queue add column if not exists artist_id text;
