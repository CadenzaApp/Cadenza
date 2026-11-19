-- Listen along: while on, the user's phone opens a listener only live session
-- whenever they play. The audience says who can join it from Listening now
-- without a code: nobody (off, the default), friends, or everyone.
--
-- live_sessions.listen_along marks those sessions, so joining one checks this
-- audience instead of session_join.
--
-- Additive and idempotent. The first version stored a boolean; that column is
-- converted in place, on to friends and off to nobody.
--
-- Applied by hand against Supabase, the same way the rest of this schema was.

alter table privacy_settings
    add column if not exists listen_along audience not null default 'nobody';

do $$
begin
    if (select data_type from information_schema.columns
        where table_name = 'privacy_settings' and column_name = 'listen_along') = 'boolean' then
        alter table privacy_settings alter column listen_along drop default;
        alter table privacy_settings alter column listen_along type audience
            using (case when listen_along then 'friends' else 'nobody' end)::audience;
        alter table privacy_settings alter column listen_along set default 'nobody';
    end if;
end
$$;

alter table live_sessions
    add column if not exists listen_along boolean not null default false;
