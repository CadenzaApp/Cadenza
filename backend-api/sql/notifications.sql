-- One row per notification the signed-in user sees on /social/notifications.
-- title and content are the two lines on the row. type is what happened.
-- metadata is {} except friend requests, which store
-- {"sender_id": "<uuid>", "resolution": null | "accepted" | "ignored"},
-- and comments, which store {"post_id": <id>}.
--
-- Idempotent. A database that still has the old icon column is rewritten.
-- Running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type notification_type as enum (
        'friend_req_received',
        'friend_req_accepted',
        'comment'
    );
exception
    when duplicate_object then null;
end
$$;

create table if not exists notifications (
    notif_id   bigint generated always as identity primary key,
    -- who sees it
    user_id    uuid not null references auth.users (id) on delete cascade,
    title      text not null,
    content    text not null,
    "type"     notification_type not null,
    created_at timestamptz not null default now(),
    unread     boolean not null default true,
    metadata   jsonb not null default '{}'::jsonb
);

-- unread rows first, newest first, then read rows, newest first.
-- notif_id breaks a created_at tie so a cursor can move past exactly one row.
-- Dropped and recreated so an older index is replaced.
-- GET /social/notifications reads the first 20 of this order.
drop index if exists notifications_user_unread_idx;
create index notifications_user_unread_idx
    on notifications (user_id, unread desc, created_at desc, notif_id desc);

-- The daily cleanup deletes rows older than 30 days. created_at asc is the
-- order that delete walks. The page read uses notifications_user_unread_idx.
create index if not exists notifications_created_at_idx
    on notifications (created_at asc);

alter table notifications disable row level security;

-- A table created before `type` and `metadata` still has `icon`. Move it over,
-- then drop the old columns. A fresh table skips this.
do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'notifications'
          and column_name = 'icon'
    ) then
        alter table notifications
            add column if not exists metadata jsonb not null default '{}'::jsonb;
        alter table notifications
            add column if not exists "type" notification_type;

        update notifications
        set "type" = case
            when content = 'accepted your friend request' then 'friend_req_accepted'::notification_type
            when content = 'sent you a friend request' then 'friend_req_received'::notification_type
            else 'comment'::notification_type
        end
        where "type" is null;

        if exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'notifications'
              and column_name = 'actor_id'
        ) then
            update notifications
            set metadata = jsonb_build_object(
                'sender_id', actor_id,
                'resolution', resolution
            )
            where "type" in ('friend_req_received', 'friend_req_accepted')
              and actor_id is not null;
        end if;

        alter table notifications alter column "type" set not null;
        alter table notifications drop constraint if exists notifications_resolution_check;
        alter table notifications drop column if exists resolution;
        alter table notifications drop column if exists actor_id;
        alter table notifications drop column icon;
    end if;
end
$$;

drop type if exists notification_icon;
