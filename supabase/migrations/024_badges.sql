-- 024_badges.sql
-- Badges de verdade: conquistados por regra, com data e progresso.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create table if not exists public.badge_awards (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  badge_code text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, season_id, badge_code)
);

create index if not exists badge_awards_user_idx on public.badge_awards(user_id, season_id);

alter table public.badge_awards enable row level security;

drop policy if exists "authenticated users view badges" on public.badge_awards;
create policy "authenticated users view badges" on public.badge_awards
  for select to authenticated using (true);

drop policy if exists "badges written by rpc" on public.badge_awards;
create policy "badges written by rpc" on public.badge_awards
  for insert to authenticated with check (false);

drop policy if exists "admins manage badges" on public.badge_awards;
create policy "admins manage badges" on public.badge_awards
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Avalia as regras e concede o que faltar. Idempotente.
create or replace function public.refresh_my_badges()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons;
  v_days integer; v_streak integer; v_types integer; v_longest integer;
  v_perfect integer; v_bonus integer; v_evo integer;
  v_duel_wins integer; v_early integer; v_late integer;
  v_new text[] := '{}';
  v_code text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('new', '[]'::jsonb); end if;

  select count(distinct score_date) into v_days
    from public.activity_score_contributions
   where user_id = auth.uid() and season_id = v_season.id and consistency_points > 0;

  select count(distinct activity_type) into v_types
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated';

  select coalesce(max(duration_seconds), 0) into v_longest
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated';

  select count(*) into v_early from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and extract(hour from started_at at time zone 'America/Sao_Paulo') < 7;

  select count(*) into v_late from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and extract(hour from started_at at time zone 'America/Sao_Paulo') >= 21;

  select count(*) into v_perfect from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id and completed_days >= 6;

  select count(*) into v_bonus from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id and bonus_points > 0;

  select coalesce(max(evolution_points), 0) into v_evo from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id;

  select count(*) into v_duel_wins from public.duels
   where season_id = v_season.id and status = 'finished' and winner_id = auth.uid();

  -- Maior sequência de dias consecutivos concluídos
  with dias as (
    select distinct score_date from public.activity_score_contributions
     where user_id = auth.uid() and season_id = v_season.id and consistency_points > 0),
  grupos as (
    select score_date, score_date - (row_number() over (order by score_date))::integer as bloco from dias)
  select coalesce(max(total), 0) into v_streak
    from (select count(*) as total from grupos group by bloco) g;

  foreach v_code in array array[
    'primeiro-dia','streak-3','streak-5','semana-perfeita','bonus-semanal',
    'madrugador','coruja','maratonista','duelista','invicto','evolucao','explorador','dedicado','veterano']
  loop
    if (v_code = 'primeiro-dia'    and v_days >= 1)
    or (v_code = 'streak-3'        and v_streak >= 3)
    or (v_code = 'streak-5'        and v_streak >= 5)
    or (v_code = 'semana-perfeita' and v_perfect >= 1)
    or (v_code = 'bonus-semanal'   and v_bonus >= 1)
    or (v_code = 'madrugador'      and v_early >= 3)
    or (v_code = 'coruja'          and v_late >= 3)
    or (v_code = 'maratonista'     and v_longest >= 3600)
    or (v_code = 'duelista'        and v_duel_wins >= 1)
    or (v_code = 'invicto'         and v_duel_wins >= 3)
    or (v_code = 'evolucao'        and v_evo >= 10)
    or (v_code = 'explorador'      and v_types >= 5)
    or (v_code = 'dedicado'        and v_days >= 10)
    or (v_code = 'veterano'        and v_days >= 20)
    then
      insert into public.badge_awards (user_id, season_id, badge_code)
      values (auth.uid(), v_season.id, v_code)
      on conflict do nothing;
      if found then v_new := array_append(v_new, v_code); end if;
    end if;
  end loop;

  return jsonb_build_object('new', to_jsonb(v_new));
end;
$$;

-- Situação de todos os badges, com progresso do que falta.
create or replace function public.my_badges()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons;
  v_days integer; v_streak integer; v_types integer; v_longest integer;
  v_perfect integer; v_bonus integer; v_evo integer;
  v_duel_wins integer; v_early integer; v_late integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform public.refresh_my_badges();

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('badges','[]'::jsonb); end if;

  select count(distinct score_date) into v_days from public.activity_score_contributions
   where user_id = auth.uid() and season_id = v_season.id and consistency_points > 0;
  select count(distinct activity_type) into v_types from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated';
  select coalesce(max(duration_seconds),0) into v_longest from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated';
  select count(*) into v_early from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and extract(hour from started_at at time zone 'America/Sao_Paulo') < 7;
  select count(*) into v_late from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and extract(hour from started_at at time zone 'America/Sao_Paulo') >= 21;
  select count(*) into v_perfect from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id and completed_days >= 6;
  select count(*) into v_bonus from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id and bonus_points > 0;
  select coalesce(max(evolution_points),0) into v_evo from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id;
  select count(*) into v_duel_wins from public.duels
   where season_id = v_season.id and status = 'finished' and winner_id = auth.uid();

  with dias as (
    select distinct score_date from public.activity_score_contributions
     where user_id = auth.uid() and season_id = v_season.id and consistency_points > 0),
  grupos as (
    select score_date, score_date - (row_number() over (order by score_date))::integer as bloco from dias)
  select coalesce(max(total), 0) into v_streak
    from (select count(*) as total from grupos group by bloco) g;

  return jsonb_build_object('badges', (
    select jsonb_agg(jsonb_build_object(
      'code', c.code, 'icon', c.icon, 'name', c.name, 'hint', c.hint,
      'current', least(c.current, c.goal), 'goal', c.goal,
      'earned_at', (select earned_at from public.badge_awards b
                     where b.user_id = auth.uid() and b.season_id = v_season.id
                       and b.badge_code = c.code)) order by c.ord)
    from (values
      ('primeiro-dia','🌱','Primeiro passo','Conclua seu primeiro dia', v_days, 1, 1),
      ('streak-3','🔥','Pegando o ritmo','3 dias seguidos', v_streak, 3, 2),
      ('streak-5','⚡','Em chamas','5 dias seguidos', v_streak, 5, 3),
      ('bonus-semanal','🎁','Bônus na conta','Feche 5 dias numa semana', v_bonus, 1, 4),
      ('semana-perfeita','🏆','Semana perfeita','6 de 6 numa semana', v_perfect, 1, 5),
      ('madrugador','🌅','Madrugador','3 atividades antes das 7h', v_early, 3, 6),
      ('coruja','🌙','Coruja','3 atividades depois das 21h', v_late, 3, 7),
      ('maratonista','🏃','Fôlego','Uma atividade de 60 minutos', v_longest, 3600, 8),
      ('explorador','🧭','Explorador','5 tipos diferentes de atividade', v_types, 5, 9),
      ('evolucao','📈','Evoluindo','10 pontos de evolução numa semana', v_evo, 10, 10),
      ('duelista','⚔️','Duelista','Vença um duelo', v_duel_wins, 1, 11),
      ('invicto','🥊','Invicto','Vença 3 duelos', v_duel_wins, 3, 12),
      ('dedicado','💪','Dedicado','10 dias concluídos', v_days, 10, 13),
      ('veterano','🎖️','Veterano','20 dias concluídos', v_days, 20, 14)
    ) as c(code, icon, name, hint, current, goal, ord)));
end;
$$;

revoke all on function public.refresh_my_badges() from public;
revoke all on function public.my_badges() from public;
grant execute on function public.refresh_my_badges() to authenticated;
grant execute on function public.my_badges() to authenticated;

commit;

notify pgrst, 'reload schema';