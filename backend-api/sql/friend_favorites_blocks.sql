-- Favorite friends and blocked accounts. Both are one direction: a row is
-- what user_id chose about the other person, and they never see it.
--
-- A favorite sorts that friend first in the caller's Friends list. Ending the
-- friendship deletes it.
--
-- A block ends any friendship or request between the pair, stops requests
-- either way, and hides each one's posts from the other.
--
-- Additive and idempotent. Creates two tables and touches nothing that
-- already exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create table if not exists friend_favorites (
    user_id    uuid not null references auth.users (id) on delete cascade,
    friend_id  uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, friend_id)
);

create table if not exists user_blocks (
    blocker_id uuid not null references auth.users (id) on delete cascade,
    blocked_id uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

-- the reverse lookup: who blocked me
create index if not exists user_blocks_blocked_idx on user_blocks (blocked_id);

-- see the note in listening_events.sql
alter table friend_favorites disable row level security;
alter table user_blocks disable row level security;
