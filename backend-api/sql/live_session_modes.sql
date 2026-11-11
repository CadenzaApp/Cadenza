-- Back, shuffle, and repeat in a live session.
--
-- live_session_queue.played_at: when an entry stopped being current, so back
-- can find the last song played. Entries played in one go share a time and
-- break the tie by their old position.
--
-- live_sessions.shuffle and repeat_mode: the session's own modes, the same for
-- everyone. Shuffle reorders what is upcoming when turned on. Repeat all puts
-- played songs back once the last one is current. Repeat one loops the
-- current song.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_session_queue
    add column if not exists played_at timestamptz;

alter table live_sessions
    add column if not exists shuffle boolean not null default false;

alter table live_sessions
    add column if not exists repeat_mode text not null default 'off'
        check (repeat_mode in ('off', 'all', 'one'));
