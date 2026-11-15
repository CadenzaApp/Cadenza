-- Invite codes: one short code that lets whoever has it into one shared
-- playlist or one live session, skipping the owner's audience setting for that
-- one thing only. Redeeming is checked and counted in db/invites.rs; joining is
-- the playlist or session code's job.
--
-- One row per thing and role: primary key (target_id, target_kind, grants_role).
-- `code` is unique, not the key. A session has no playlist role; grants_role is
-- '' there, because a primary key column cannot be null. A playlist code is
-- 'viewer' or 'editor'.
--
-- Idempotent. A database that still keys the table on `code` is moved over:
-- extra rows for the same thing and role are deleted, keeping a usable code
-- when there is one, else the newest.
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
    code        text not null unique,
    target_kind invite_target not null,
    -- the playlist's bigint id or the session's uuid, as text
    target_id   text not null,
    -- playlist: viewer or editor. session: '' (no role)
    grants_role text not null,
    created_by  uuid not null references auth.users (id) on delete cascade,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz,
    max_uses    int check (max_uses > 0),
    uses        int not null default 0,
    revoked_at  timestamptz,
    primary key (target_id, target_kind, grants_role),
    constraint invite_codes_grants_role_check check (
        (target_kind = 'shared_playlist' and grants_role in ('viewer', 'editor'))
        or (target_kind = 'live_session' and grants_role = '')
    )
);

-- A table created by the old script still has `code` as its primary key.
do $$
declare
    role_check text;
begin
    if exists (
        select 1
        from pg_index i
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        where i.indrelid = 'public.invite_codes'::regclass
          and i.indisprimary
          and a.attname = 'code'
    ) then
        delete from invite_codes s
        using (
            select code
            from (
                select code,
                       row_number() over (
                           partition by target_id, target_kind, coalesce(grants_role, '')
                           order by
                               (revoked_at is null
                                and (expires_at is null or expires_at > now())
                                and (max_uses is null or uses < max_uses)) desc,
                               created_at desc,
                               code desc
                       ) as rn
                from invite_codes
            ) ranked
            where rn > 1
        ) dupes
        where s.code = dupes.code;

        update invite_codes set grants_role = '' where grants_role is null;

        alter table invite_codes drop constraint invite_codes_pkey;
        alter table invite_codes alter column grants_role set not null;

        select conname into role_check
        from pg_constraint
        where conrelid = 'public.invite_codes'::regclass
          and contype = 'c'
          and pg_get_constraintdef(oid) ilike '%grants_role%';
        if role_check is not null then
            execute format('alter table invite_codes drop constraint %I', role_check);
        end if;
        alter table invite_codes add constraint invite_codes_grants_role_check check (
            (target_kind = 'shared_playlist' and grants_role in ('viewer', 'editor'))
            or (target_kind = 'live_session' and grants_role = '')
        );

        alter table invite_codes
            add primary key (target_id, target_kind, grants_role);
        alter table invite_codes
            add constraint invite_codes_code_key unique (code);
        drop index if exists invite_codes_target_idx;
    end if;
end
$$;

-- see the note in listening_events.sql
alter table invite_codes disable row level security;
