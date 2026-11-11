-- Listen along: while on, the user's phone opens a listener only live session
-- whenever they play, so friends their session_join audience allows can join
-- from Listening now without a code. Off by default.
--
-- Additive and idempotent. Adds one column to privacy_settings.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

alter table privacy_settings
    add column if not exists listen_along boolean not null default false;
