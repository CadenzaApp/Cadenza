-- Decorative labels on a social post. One row is one tag on one post:
-- its own text and color. These are not song tags. Deleting the post
-- removes its rows. tag_id stays put when the text changes, so an edit
-- can name the row.
--
-- Additive and idempotent. Applied by hand against Supabase.

create table if not exists post_tags_applied (
    tag_id  bigint generated always as identity primary key,
    post_id bigint not null references posts (post_id) on delete cascade,
    text    text not null,
    color   text not null,
    constraint post_tags_applied_text_len check (char_length(text) between 1 and 24),
    constraint post_tags_applied_color_hex check (color ~ '^#[0-9a-f]{6}$')
);

-- one word per post, ignoring case. the stored spelling is the author's.
create unique index if not exists post_tags_applied_word_idx
    on post_tags_applied (post_id, lower(text));

-- Supabase turns row level security on for new tables by default. Every other
-- table in this schema has it off, and the api connects as the owner, which
-- bypasses it anyway. Left on it would silently return nothing to any other
-- role, so match the rest of the schema instead of being the one exception.
alter table post_tags_applied disable row level security;
