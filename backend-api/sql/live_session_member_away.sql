-- live_session_members.away_since and closed_app: the same as the host's
-- host_away_since and host_closed_app, for everyone else in a session. A
-- member whose app was closed for a minute, or went quiet for 10, is taken
-- out of the session by the sweep, so a listener who swiped the app away does
-- not stay in it forever. Null and false while connected.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_session_members
    add column if not exists away_since timestamptz;
alter table live_session_members
    add column if not exists closed_app boolean not null default false;
