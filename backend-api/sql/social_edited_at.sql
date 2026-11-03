-- When the author last edited a post or comment, stamped with `now()`.
-- Null means never edited. The client's timestamp decides whether a later
-- edit is older than this value and should be ignored.
--
-- Additive and idempotent. Adds one nullable column to each table and touches
-- nothing that already exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

alter table posts
    add column if not exists edited_at timestamptz;

alter table comments
    add column if not exists edited_at timestamptz;
