-- live_sessions.host_closed_app: the host's realtime connection was closed,
-- as when the app is swiped away, rather than going quiet, as when a paused
-- app is frozen in the background. Closed ends the session a minute later
-- whether or not it was playing; quiet only does while playing.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_sessions
    add column if not exists host_closed_app boolean not null default false;
