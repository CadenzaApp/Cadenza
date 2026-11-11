-- live_sessions.host_away_since: when the host's app last lost its realtime
-- connection, cleared when it comes back. A session playing with its host
-- away past a minute ended because the app was closed. Null while connected.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_sessions
    add column if not exists host_away_since timestamptz;
