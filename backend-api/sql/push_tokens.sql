-- One row per Expo push token (ExponentPushToken[...]) a phone registered.
-- A token is one install on one device, so it belongs to one user at a time:
-- the phone registers it after sign in, and a later sign in by someone else on
-- the same phone moves it to them. Signing out deletes it. A token Expo
-- reports as DeviceNotRegistered is deleted by the backend.
--
-- Idempotent. Running it twice is a no-op.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create table if not exists push_tokens (
    token      text primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    -- the last time a phone registered it
    updated_at timestamptz not null default now()
);

-- every push reads all of one user's tokens
create index if not exists push_tokens_user_id_idx on push_tokens (user_id);

alter table push_tokens disable row level security;
