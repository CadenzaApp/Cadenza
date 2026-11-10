-- One row per notification the signed-in user sees on /social/notifications.
-- title and content are the two lines on the row. icon is which glyph to draw.
--
-- Additive. Creates one type, one table, and its index, and touches nothing
-- that already exists. Idempotent, so running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

do $$
begin
    create type notification_icon as enum ('heart', 'chatbubble', 'person-add');
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
    icon       notification_icon not null,
    created_at timestamptz not null default now(),
    unread     boolean not null default true
);

-- unread rows first, newest first, then read rows, newest first.
-- notif_id breaks a created_at tie so a cursor can move past exactly one row.
-- Dropped and recreated so an older index is replaced.
-- GET /social/notifications reads the first 20 of this order.
drop index if exists notifications_user_unread_idx;
create index notifications_user_unread_idx
    on notifications (user_id, unread desc, created_at desc, notif_id desc);

alter table notifications disable row level security;
