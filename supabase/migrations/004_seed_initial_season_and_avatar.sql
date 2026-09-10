-- Adds the profile emoji and a repeatable initial season for new environments.
alter table public.profiles
  add column if not exists avatar_emoji text default '🪩';

update public.profiles
set avatar_emoji = '🪩'
where avatar_emoji is null;

insert into public.seasons (name, description, start_date, end_date, status, entry_fee)
select
  'MOVE Challenge — Temporada 1',
  'Oito semanas para construir consistência, um movimento por vez.',
  current_date,
  current_date + 56,
  'registration',
  0
where not exists (
  select 1 from public.seasons where name = 'MOVE Challenge — Temporada 1'
);