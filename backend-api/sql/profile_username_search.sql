-- Case-insensitive substring search on profile.username
-- (GET /social/users?search=).
--
-- The unique btree on username does not serve
-- `lower(username) LIKE '%term%'`. This trigram index does, once the term is
-- long enough to contain a trigram. Shorter terms still return, by a scan,
-- and the query caps the rows.
--
-- Supabase installs pg_trgm into the extensions schema. The operator class is
-- qualified so the index builds from a session whose search_path omits it.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create extension if not exists pg_trgm with schema extensions;

create index if not exists profile_username_trgm_idx
    on profile using gin (lower(username) extensions.gin_trgm_ops);
