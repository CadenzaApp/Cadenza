-- Asking to join a live session. With live_sessions.approve_joins on (the
-- default), someone the host's audience allows who joins without a code is
-- not let in straight away: a pending row lands here, and the host gets a
-- notification to let them in or not. A code always joins at once.
--
-- The host's notification is type session_join_request, metadata
-- {"sender_id": requester, "session_id": ..., "resolution": null | "accepted" | "ignored"}.
-- The requester gets session_join_accepted once let in.
--
-- Additive and idempotent. Applied by hand against Supabase.

alter table live_sessions
    add column if not exists approve_joins boolean not null default true;

create table if not exists live_session_join_requests (
    session_id   uuid not null references live_sessions (session_id) on delete cascade,
    user_id      uuid not null references auth.users (id) on delete cascade,
    status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'ignored')),
    requested_at timestamptz not null default now(),
    primary key (session_id, user_id)
);

create index if not exists live_session_join_requests_pending_idx
    on live_session_join_requests (session_id, requested_at)
    where status = 'pending';

alter type notification_type add value if not exists 'session_join_request';
alter type notification_type add value if not exists 'session_join_accepted';
