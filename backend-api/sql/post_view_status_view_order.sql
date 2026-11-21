-- Order a post was viewed, used as the history cursor.
--
-- `view_order` is set only when a post is marked `viewed`, in the order of
-- the ids in that request, starting at the user's current maximum. A later
-- view replaces the number with a higher one. A `loaded` row has no number. Existing `feed_order` values are renamed. Numbers on
-- rows that are not `viewed` are cleared.
--
-- Additive and idempotent. Applied by hand against Supabase.
--
-- `post_view_status_viewed_idx` stays. The first feed page still reads the
-- three newest views by `date` for `initial_spotlight_chance=history`.

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'post_view_status' and column_name = 'feed_order'
    ) then
        alter table post_view_status rename column feed_order to view_order;
    elsif not exists (
        select 1 from information_schema.columns
        where table_name = 'post_view_status' and column_name = 'view_order'
    ) then
        alter table post_view_status add column view_order integer;
    end if;
end $$;

alter table post_view_status alter column view_order drop not null;

update post_view_status
set view_order = null
where status <> 'viewed';

drop index if exists post_view_status_user_feed_order_idx;

create unique index if not exists post_view_status_user_view_order_idx
    on post_view_status (user_id, view_order);
