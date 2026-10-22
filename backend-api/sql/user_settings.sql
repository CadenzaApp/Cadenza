-- Per user app settings: appearance and content preferences. Private, unlike
-- profile, which is public social data. One row per user, created on first
-- PATCH /settings. A user with no row reads the column defaults.
--
-- Additive and idempotent. Creates one table and touches nothing that already
-- exists.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

create table if not exists user_settings (
    user_id             uuid primary key references auth.users (id) on delete cascade,
    -- custom draws background_color, light or dark text picked from it
    theme_mode          text not null default 'system'
                        check (theme_mode in ('system', 'light', 'dark', 'custom')),
    -- null means the app default accent
    accent_color        text check (accent_color ~ '^#[0-9a-f]{6}$'),
    -- the custom mode background. Kept when another mode is picked
    background_color    text check (background_color ~ '^#[0-9a-f]{6}$'),
    -- null means untinted glass
    glass_tint          text check (glass_tint ~ '^#[0-9a-f]{6}$'),
    -- clear is plain liquid glass, tinted is more opaque. The same choice iOS
    -- 26.1 offers in Settings, which apps cannot read
    glass_style         text not null default 'clear'
                        check (glass_style in ('clear', 'tinted')),
    -- color slots: a json array of up to 24 entries, each '#rrggbb' or null for
    -- an empty slot. null means the presets. Accent and tint on the Appearance
    -- sheet, tag colors in the tag create and recolor dialogs
    accent_swatches     jsonb,
    glass_tint_swatches jsonb,
    tag_color_swatches  jsonb,
    background_swatches jsonb,
    hide_explicit       boolean not null default false,
    -- suggested tag pills under songs in music lists
    show_suggested_tags boolean not null default true,
    updated_at          timestamptz not null default now()
);

-- glass_intensity was replaced by glass_style. For a table made before that
alter table user_settings
    add column if not exists glass_style text not null default 'clear'
    check (glass_style in ('clear', 'tinted'));
alter table user_settings drop column if exists glass_intensity;

-- custom color slots, added after the table first shipped
alter table user_settings add column if not exists accent_swatches jsonb;
alter table user_settings add column if not exists glass_tint_swatches jsonb;
alter table user_settings add column if not exists tag_color_swatches jsonb;

-- the custom background mode
alter table user_settings add column if not exists background_color text
    check (background_color ~ '^#[0-9a-f]{6}$');
alter table user_settings add column if not exists background_swatches jsonb;
alter table user_settings drop constraint if exists user_settings_theme_mode_check;
alter table user_settings add constraint user_settings_theme_mode_check
    check (theme_mode in ('system', 'light', 'dark', 'custom'));
