-- What a profile shows besides listening: the user's shared playlists and the
-- saved queries they chose to share. Each has its own audience in
-- privacy_settings, and a saved query shows only once `shared` is on.
--
-- Additive and idempotent. Adds three columns and touches nothing else.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

alter table privacy_settings
    add column if not exists profile_playlists audience not null default 'friends';
alter table privacy_settings
    add column if not exists profile_queries audience not null default 'friends';

-- shown on the owner's profile, to whoever profile_queries lets in
alter table saved_queries
    add column if not exists shared boolean not null default false;
