-- live_sessions.repeat_mode and live_session_join_requests.status as enums,
-- like the rest of the session columns, so the entities carry a typed value
-- instead of text.
--
-- Idempotent. Applied by hand against Supabase.

do $$
begin
    create type repeat_mode as enum ('off', 'all', 'one');
exception
    when duplicate_object then null;
end
$$;

do $$
begin
    create type join_request_status as enum ('pending', 'accepted', 'ignored');
exception
    when duplicate_object then null;
end
$$;

alter table live_sessions drop constraint if exists live_sessions_repeat_mode_check;
alter table live_session_join_requests drop constraint if exists live_session_join_requests_status_check;

do $$
begin
    if (select data_type from information_schema.columns
        where table_name = 'live_sessions' and column_name = 'repeat_mode') = 'text' then
        alter table live_sessions alter column repeat_mode drop default;
        alter table live_sessions
            alter column repeat_mode type repeat_mode using repeat_mode::repeat_mode;
        alter table live_sessions alter column repeat_mode set default 'off';
    end if;
    if (select data_type from information_schema.columns
        where table_name = 'live_session_join_requests' and column_name = 'status') = 'text' then
        drop index if exists live_session_join_requests_pending_idx;
        alter table live_session_join_requests alter column status drop default;
        alter table live_session_join_requests
            alter column status type join_request_status using status::join_request_status;
        alter table live_session_join_requests alter column status set default 'pending';
    end if;
end
$$;

create index if not exists live_session_join_requests_pending_idx
    on live_session_join_requests (session_id, requested_at)
    where status = 'pending';
