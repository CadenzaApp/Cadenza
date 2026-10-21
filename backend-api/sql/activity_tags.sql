-- Activity tags: the partial unique index that keeps one shared activity tag row per name. See
-- the Activity tags section of src/db/README.md.
--
-- db::activity_tags::get_activity_tags creates a missing activity tag with
-- ON CONFLICT (name) WHERE is_activity DO NOTHING, which Postgres refuses unless this index
-- exists. Without it, adding a new ActivityTag variant breaks every activity tag read and every
-- POST /events, since a play moves activity tags in the same transaction.
--
-- Fails if two activity tags already share a name. Find them first with:
--   select name, count(*) from tags where is_activity group by name having count(*) > 1;
--
-- Additive and idempotent. Applied by hand against Supabase, the same way the rest of this
-- schema was.

create unique index if not exists tags_activity_name_idx on tags (name) where is_activity;
