-- Query sort: the collation POST /queries/results sorts titles, artists and albums in. See
-- src/db/queries.rs.
--
-- ICU with numeric ordering, so "Track 9" comes before "Track 10" and case does not split
-- the list, the same way the app sorts a song list on the phone (Intl.Collator with
-- numeric: true). Needs a Postgres built with ICU, which Supabase is.
--
-- Additive and idempotent. Creates one collation and touches nothing that already exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was. Every query
-- that sorts by title, artist or album fails until it is.

create collation if not exists natural_sort (provider = icu, locale = 'und-u-kn');
