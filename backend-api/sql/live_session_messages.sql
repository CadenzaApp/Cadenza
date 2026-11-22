-- Live session chat. Anyone in an open session, host or member of any role,
-- posts a message over HTTP; the server publishes a `chat` realtime event on
-- the session topic carrying the message itself. Everyone in the session reads
-- the whole history, late joiners included.
--
-- A message does not bump live_sessions.version: chat is not part of the
-- session snapshot, so it never makes members refetch it.
--
-- Additive and idempotent. Applied by hand against Supabase.

create table if not exists live_session_messages (
    message_id bigserial primary key,
    session_id uuid not null references live_sessions (session_id) on delete cascade,
    -- null once the sender's account is gone; the message stays
    user_id    uuid references auth.users (id) on delete set null,
    body       text not null check (length(body) between 1 and 1000),
    sent_at    timestamptz not null default now()
);

create index if not exists live_session_messages_session_idx
    on live_session_messages (session_id, message_id desc);

-- see the note in listening_events.sql
alter table live_session_messages disable row level security;
