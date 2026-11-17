-- Invite codes: one short code that lets whoever has it into one shared
-- playlist or one live session, skipping the owner's audience setting for that
-- one thing only. Redeeming is checked and counted in db/invites.rs; joining is
-- the playlist or session code's job.
--
-- Additive and idempotent. Creates one type and one table.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type invite_target as enum ('shared_playlist', 'live_session');
exception
    when duplicate_object then null;
end
$$;

create table if not exists invite_codes (
    -- 8 chars from an alphabet with no 0 O 1 I L
    code        text primary key,
    target_kind invite_target not null,
    -- the playlist's bigint id or the session's uuid, as text
    target_id   text not null,
    -- what a playlist code joins as: viewer or editor. null for sessions
    grants_role text check (grants_role in ('viewer', 'editor')),
    created_by  uuid not null references auth.users (id) on delete cascade,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz,
    max_uses    int check (max_uses > 0),
    uses        int not null default 0,
    revoked_at  timestamptz
);

-- listing and revoking the codes for one target
create index if not exists invite_codes_target_idx
    on invite_codes (target_kind, target_id);

-- see the note in listening_events.sql
alter table invite_codes disable row level security;
