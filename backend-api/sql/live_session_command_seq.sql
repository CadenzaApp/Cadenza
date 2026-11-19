-- live_sessions.command_seq counts playback changes the host's phone did not
-- make itself: a controller's play, pause, seek, skip, or jump, a song played
-- now, a first song landing in an empty session, a hand over. The host's
-- reports never move it. So the host's phone knows which snapshots to follow,
-- and ignores the rest (a join, a queue edit) instead of jumping to the
-- server's projection.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_sessions
    add column if not exists command_seq bigint not null default 0;
