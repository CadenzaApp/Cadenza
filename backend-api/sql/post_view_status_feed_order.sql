-- Load order for one user's feed, used as the previously viewed cursor.
--
-- `feed_order` is assigned when a row is first written, increasing from that
-- user's current maximum: a loaded feed page, a post the author just created
-- (marked `viewed`), or a view of a post that had no row yet. Existing rows
-- are numbered by their old view time so the section has an order before any
-- new page is loaded. The column is not null.
--
-- Additive and idempotent. Applied by hand against Supabase.
--
-- `post_view_status_viewed_idx` stays. The first feed page still reads the
-- three newest views by `date` for `initial_spotlight_chance=history`.

alter table post_view_status
    add column if not exists feed_order integer;

with ranked as (
    select user_id,
           post_id,
           row_number() over (
               partition by user_id
               order by date asc, post_id asc
           )::integer as n
    from post_view_status
    where feed_order is null
),
base as (
    select user_id, coalesce(max(feed_order), 0) as floor
    from post_view_status
    group by user_id
)
update post_view_status as v
set feed_order = base.floor + ranked.n
from ranked
join base using (user_id)
where v.user_id = ranked.user_id
  and v.post_id = ranked.post_id
  and v.feed_order is null;

create unique index if not exists post_view_status_user_feed_order_idx
    on post_view_status (user_id, feed_order);

alter table post_view_status
    alter column feed_order set not null;
