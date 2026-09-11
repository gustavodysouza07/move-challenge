-- 027_daily_steps_and_fair_evolution.sql
-- a) passos viram registro diário com comprovante e validação;
-- b) evolução ganha base mínima, para quem declara zero não ser eliminado
--    nem para quem declara quase zero ganhar o teto na primeira atividade;
-- c) desafio de passos passa a somar dias, sem duplicar.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ------------------------------------------------ 1. Parâmetros novos
update public.seasons
   set rules = coalesce(rules, '{}'::jsonb)
             || jsonb_build_object('min_baseline_minutes', 10, 'min_baseline_steps', 2000)
 where status = 'draft'
    or not (rules ? 'min_baseline_minutes');

-- ------------------------------------------------ 2. Passos por dia
do $$ begin
  create type public.steps_status as enum ('pending_validation','validated','rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.daily_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  step_date date not null,
  steps integer not null check (steps >= 0 and steps <= 100000),
  storage_path text not null,
  status public.steps_status not null default 'pending_validation',
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, season_id, step_date)
);

create index if not exists daily_steps_validation_idx on public.daily_steps(status, created_at);

alter table public.daily_steps enable row level security;

drop policy if exists "participants view own steps" on public.daily_steps;
create policy "participants view own steps" on public.daily_steps
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "steps written by rpc" on public.daily_steps;
create policy "steps written by rpc" on public.daily_steps
  for insert to authenticated with check (false);
drop policy if exists "admins manage steps" on public.daily_steps;
create policy "admins manage steps" on public.daily_steps
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop trigger if exists daily_steps_set_updated_at on public.daily_steps;
create trigger daily_steps_set_updated_at before update on public.daily_steps
  for each row execute function public.set_updated_at();

-- Um dia pode pontuar sem sessão registrada (meta batida só por passos).
alter table public.activity_score_contributions alter column activity_session_id drop not null;
create unique index if not exists contributions_steps_day_idx
  on public.activity_score_contributions(user_id, season_id, score_date)
  where activity_session_id is null;

-- ------------------------------------------------ 3. Enviar passos do dia
create or replace function public.submit_daily_steps(
  p_step_date date, p_steps integer, p_storage_path text
) returns public.daily_steps language plpgsql security definer set search_path = public, storage as $$
declare v_season public.seasons; v_row public.daily_steps; v_object storage.objects;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_steps is null or p_steps < 0 or p_steps > 100000 then
    raise exception 'informe um número de passos entre 0 e 100000';
  end if;
  if nullif(trim(coalesce(p_storage_path,'')), '') is null
     or split_part(p_storage_path, '/', 1) <> auth.uid()::text then
    raise exception 'invalid proof path';
  end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then raise exception 'nenhuma temporada em andamento'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid() and status = 'active') then
    raise exception 'sua participação ainda não está ativa';
  end if;

  if p_step_date > current_date then raise exception 'não dá para lançar passos de um dia futuro'; end if;
  if current_date - p_step_date > 1 then
    raise exception 'os passos só podem ser lançados no mesmo dia ou no dia seguinte';
  end if;
  if p_step_date < v_season.start_date or p_step_date > v_season.end_date then
    raise exception 'essa data está fora da temporada';
  end if;

  select * into v_object from storage.objects
   where bucket_id = 'activity-proofs' and name = p_storage_path;
  if v_object.id is null then raise exception 'proof file not found'; end if;
  if coalesce((v_object.metadata ->> 'size')::bigint, 0) > 5242880 then
    raise exception 'o comprovante precisa ter até 5 MB';
  end if;

  insert into public.daily_steps (user_id, season_id, step_date, steps, storage_path)
  values (auth.uid(), v_season.id, p_step_date, p_steps, p_storage_path)
  on conflict (user_id, season_id, step_date) do update
    set steps = excluded.steps, storage_path = excluded.storage_path,
        status = 'pending_validation', rejection_reason = null, updated_at = now()
  where public.daily_steps.status <> 'validated'
  returning * into v_row;

  if v_row.id is null then raise exception 'os passos deste dia já foram validados'; end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'daily_steps', v_row.id, 'submitted',
          jsonb_build_object('date', p_step_date, 'steps', p_steps));

  return v_row;
end;
$$;

-- ------------------------------------- 4. Passos validados viram pontuação
create or replace function public.apply_validated_daily_steps(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row public.daily_steps; v_season public.seasons;
  v_min_steps integer; v_per_day integer; v_week integer; v_week_start date;
begin
  select * into v_row from public.daily_steps where id = p_id and status = 'validated';
  if v_row.id is null then return; end if;

  select * into v_season from public.seasons where id = v_row.season_id;
  v_min_steps := coalesce((v_season.rules ->> 'daily_steps')::integer, 8000);
  v_per_day := coalesce((v_season.rules ->> 'consistency_per_day')::integer, 10);

  v_week := public.current_season_week(v_season.id, v_row.step_date);
  v_week_start := v_season.start_date + ((v_week - 1) * 7);
  if v_row.step_date < v_week_start or v_row.step_date > v_week_start + 5 then return; end if;
  if v_row.steps < v_min_steps then return; end if;

  insert into public.activity_score_contributions
    (activity_session_id, user_id, season_id, score_date,
     consistency_points, evolution_points, volume_points)
  values (null, v_row.user_id, v_row.season_id, v_row.step_date, v_per_day, 0, 0)
  on conflict do nothing;

  insert into public.daily_scores
    (user_id, season_id, score_date, consistency_points, evolution_points, volume_points)
  select v_row.user_id, v_row.season_id, c.score_date,
         least(v_per_day, sum(c.consistency_points)),
         least(coalesce((v_season.rules ->> 'evolution_cap')::integer, 25), sum(c.evolution_points)),
         least(coalesce((v_season.rules ->> 'volume_cap')::integer, 20), sum(c.volume_points))
    from public.activity_score_contributions c
   where c.user_id = v_row.user_id and c.season_id = v_row.season_id
     and c.score_date = v_row.step_date
   group by c.score_date
  on conflict (user_id, season_id, score_date) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points, calculated_at = now();

  insert into public.weekly_scores (user_id, season_id, week_number, consistency_points)
  select v_row.user_id, v_row.season_id, v_week,
         least(coalesce((v_season.rules ->> 'weekly_consistency_cap')::integer, 60),
               coalesce(sum(c.consistency_points), 0))
    from public.activity_score_contributions c
   where c.user_id = v_row.user_id and c.season_id = v_row.season_id
     and c.score_date between v_week_start and v_week_start + 5
  on conflict (user_id, season_id, week_number) do update
    set consistency_points = excluded.consistency_points, updated_at = now();

  perform public.refresh_weekly_bonus(v_row.user_id, v_row.season_id, v_week);
end;
$$;

create or replace function public.admin_validate_daily_steps(
  p_id uuid, p_approved boolean, p_reason text default null
) returns public.daily_steps language plpgsql security definer set search_path = public as $$
declare v_row public.daily_steps;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if not p_approved and nullif(trim(coalesce(p_reason,'')), '') is null then
    raise exception 'escreva o motivo da recusa';
  end if;

  update public.daily_steps
     set status = case when p_approved then 'validated'::public.steps_status
                                       else 'rejected'::public.steps_status end,
         rejection_reason = case when p_approved then null else trim(p_reason) end,
         updated_at = now()
   where id = p_id and status = 'pending_validation'
  returning * into v_row;
  if v_row.id is null then raise exception 'registro de passos não encontrado'; end if;

  if p_approved then perform public.apply_validated_daily_steps(v_row.id); end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'daily_steps', v_row.id,
          case when p_approved then 'validated' else 'rejected' end,
          jsonb_build_object('reason', p_reason));

  return v_row;
end;
$$;

-- ------------------------- 5. Consistência por tempo, evolução com base mínima
create or replace function public.apply_validated_activity_score(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_activity public.activity_sessions; v_season public.seasons;
  v_baseline public.baseline_metrics; v_rules jsonb;
  v_min_seconds integer; v_per_day integer; v_cons_cap integer;
  v_evo_cap integer; v_vol_cap integer; v_met_per_point integer; v_min_base numeric;
  v_week_number integer; v_week_start date; v_met numeric;
  v_consistency integer; v_evolution integer; v_volume integer; v_contribution_id uuid;
begin
  select * into v_activity from public.activity_sessions
   where id = p_session_id and status = 'validated';
  if v_activity.id is null then raise exception 'validated activity not found'; end if;

  select * into v_season from public.seasons where id = v_activity.season_id;
  v_rules := coalesce(v_season.rules, '{}'::jsonb);

  v_min_seconds   := coalesce((v_rules ->> 'daily_minutes')::integer, 30) * 60;
  v_per_day       := coalesce((v_rules ->> 'consistency_per_day')::integer, 10);
  v_cons_cap      := coalesce((v_rules ->> 'weekly_consistency_cap')::integer, 60);
  v_evo_cap       := coalesce((v_rules ->> 'evolution_cap')::integer, 25);
  v_vol_cap       := coalesce((v_rules ->> 'volume_cap')::integer, 20);
  v_met_per_point := greatest(1, coalesce((v_rules ->> 'met_min_per_point')::integer, 40));
  v_min_base      := greatest(1, coalesce((v_rules ->> 'min_baseline_minutes')::integer, 10));

  v_week_number := public.current_season_week(v_season.id, v_activity.started_at::date);
  v_week_start := v_season.start_date + ((v_week_number - 1) * 7);
  if v_activity.started_at::date < v_week_start
     or v_activity.started_at::date > v_week_start + 5 then return; end if;

  select * into v_baseline from public.baseline_metrics
   where season_id = v_activity.season_id and user_id = v_activity.user_id;

  v_met := case v_activity.activity_type
    when 'Caminhada leve' then 3.5 when 'Caminhada rápida / inclinação' then 5
    when 'Musculação moderada' then 4 when 'Musculação pesada' then 6
    when 'Bike / spinning' then 7 when 'Natação' then 7 when 'Corrida' then 8
    when 'Funcional / HIIT' then 8 when 'Yoga / alongamento' then 2.5 else 1 end;

  -- Consistência por tempo. Passos entram pelo registro diário.
  v_consistency := case when coalesce(v_activity.duration_seconds, 0) >= v_min_seconds
                        then v_per_day else 0 end;

  -- Base mínima: protege quem declarou zero e impede teto instantâneo.
  v_evolution := case
    when v_baseline.frozen_at is not null then
      least(v_evo_cap, greatest(0, floor(
        (((v_activity.duration_seconds / 60.0)
          / greatest(v_baseline.average_active_minutes, v_min_base) - 1) * 100) / 2)::integer))
    else 0 end;

  v_volume := least(v_vol_cap,
    floor((v_met * coalesce(v_activity.duration_seconds, 0) / 60) / v_met_per_point)::integer);

  insert into public.activity_score_contributions
    (activity_session_id, user_id, season_id, score_date,
     consistency_points, evolution_points, volume_points)
  values (v_activity.id, v_activity.user_id, v_activity.season_id,
          v_activity.started_at::date, v_consistency, v_evolution, v_volume)
  on conflict (activity_session_id) do nothing
  returning id into v_contribution_id;

  if v_contribution_id is null then return; end if;

  insert into public.daily_scores
    (user_id, season_id, score_date, consistency_points, evolution_points, volume_points)
  select v_activity.user_id, v_activity.season_id, c.score_date,
         least(v_per_day, sum(c.consistency_points)),
         least(v_evo_cap, sum(c.evolution_points)),
         least(v_vol_cap, sum(c.volume_points))
    from public.activity_score_contributions c
   where c.user_id = v_activity.user_id and c.season_id = v_activity.season_id
     and c.score_date = v_activity.started_at::date
   group by c.score_date
  on conflict (user_id, season_id, score_date) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points, calculated_at = now();

  insert into public.weekly_scores (user_id, season_id, week_number,
    consistency_points, evolution_points, volume_points)
  select v_activity.user_id, v_activity.season_id, v_week_number,
         least(v_cons_cap, coalesce(sum(c.consistency_points), 0)),
         least(v_evo_cap, coalesce(sum(c.evolution_points), 0)),
         least(v_vol_cap, coalesce(sum(c.volume_points), 0))
    from public.activity_score_contributions c
   where c.user_id = v_activity.user_id and c.season_id = v_activity.season_id
     and c.score_date between v_week_start and v_week_start + 5
  on conflict (user_id, season_id, week_number) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points, updated_at = now();

  perform public.refresh_weekly_bonus(v_activity.user_id, v_activity.season_id, v_week_number);
end;
$$;

-- --------------------- 6. Desafio de passos passa a somar dias validados
create or replace function public.evaluate_my_challenges()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons; v_week integer; v_start date; v_end date;
  v_minutes integer; v_steps integer; v_types integer; v_longest integer;
  v_early integer; v_late integer; v_days integer; v_streak integer;
  v_duel boolean; v_best_prev integer; v_prev_minutes integer;
  v_row record; v_ok boolean; v_new text[] := '{}'; v_gained integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('new','[]'::jsonb); end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid() and status = 'active') then
    return jsonb_build_object('new','[]'::jsonb);
  end if;

  v_week := public.current_season_week(v_season.id);
  v_start := v_season.start_date + ((v_week - 1) * 7);
  v_end := v_start + 5;

  select coalesce(sum(duration_seconds) / 60, 0), count(distinct activity_type),
         coalesce(max(duration_seconds), 0),
         count(*) filter (where extract(hour from started_at at time zone 'America/Sao_Paulo') < 7),
         count(*) filter (where extract(hour from started_at at time zone 'America/Sao_Paulo') >= 21)
    into v_minutes, v_types, v_longest, v_early, v_late
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and started_at::date between v_start and v_end;

  select coalesce(sum(steps), 0) into v_steps from public.daily_steps
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and step_date between v_start and v_end;

  select count(distinct score_date) into v_days
    from public.activity_score_contributions
   where user_id = auth.uid() and season_id = v_season.id
     and score_date between v_start and v_end and consistency_points > 0;

  with dias as (
    select distinct score_date from public.activity_score_contributions
     where user_id = auth.uid() and season_id = v_season.id
       and score_date between v_start and v_end and consistency_points > 0),
  blocos as (
    select score_date - (row_number() over (order by score_date))::integer as bloco from dias)
  select coalesce(max(total), 0) into v_streak
    from (select count(*) as total from blocos group by bloco) g;

  v_duel := exists (select 1 from public.duels
                     where season_id = v_season.id and week_number = v_week
                       and status in ('accepted','finished')
                       and auth.uid() in (challenger_id, opponent_id));

  select coalesce(max(completed_days), 0) into v_best_prev from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id and week_number < v_week;

  select coalesce(sum(duration_seconds) / 60, 0) into v_prev_minutes
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and started_at::date between v_start - 7 and v_start - 2;

  for v_row in
    select sc.code, sc.points from public.season_challenges sc
     where sc.season_id = v_season.id and sc.week_number = v_week
       and not exists (select 1 from public.challenge_completions cc
                        where cc.user_id = auth.uid() and cc.season_id = v_season.id
                          and cc.week_number = v_week and cc.code = sc.code)
  loop
    v_ok := case v_row.code
      when 'maratonista'    then v_minutes >= 150
      when 'dez-mil'        then v_steps >= 50000
      when 'folego'         then v_longest >= 3600
      when 'explorador'     then v_types >= 3
      when 'madrugador'     then v_early >= 3
      when 'noturno'        then v_late >= 3
      when 'sem-falhar'     then v_streak >= 4
      when 'arena'          then v_duel
      when 'superacao'      then v_week > 1 and v_days > v_best_prev
      when 'acima-da-media' then v_week > 1 and v_prev_minutes > 0 and v_minutes >= v_prev_minutes * 1.2
      else false end;

    if v_ok then
      insert into public.challenge_completions (user_id, season_id, week_number, code, points)
      values (auth.uid(), v_season.id, v_week, v_row.code, v_row.points);
      v_new := array_append(v_new, v_row.code);
      v_gained := v_gained + v_row.points;
    end if;
  end loop;

  if v_gained > 0 then
    insert into public.weekly_scores (user_id, season_id, week_number, challenge_points)
    values (auth.uid(), v_season.id, v_week, v_gained)
    on conflict (user_id, season_id, week_number) do update
      set challenge_points = public.weekly_scores.challenge_points + v_gained,
          updated_at = now();
  end if;

  return jsonb_build_object('new', to_jsonb(v_new), 'points', v_gained);
end;
$$;

-- --------------------------- 7. Extrato: como cada ponto foi calculado
create or replace function public.my_score_breakdown()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_rules jsonb; v_baseline public.baseline_metrics;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('season', null); end if;

  v_rules := coalesce(v_season.rules, '{}'::jsonb);
  select * into v_baseline from public.baseline_metrics
   where season_id = v_season.id and user_id = auth.uid();

  return jsonb_build_object(
    'season', jsonb_build_object('name', v_season.name, 'week', public.current_season_week(v_season.id)),
    'rules', jsonb_build_object(
      'daily_minutes', coalesce((v_rules ->> 'daily_minutes')::integer, 30),
      'daily_steps', coalesce((v_rules ->> 'daily_steps')::integer, 8000),
      'consistency_per_day', coalesce((v_rules ->> 'consistency_per_day')::integer, 10),
      'weekly_consistency_cap', coalesce((v_rules ->> 'weekly_consistency_cap')::integer, 60),
      'bonus_days', coalesce((v_rules ->> 'bonus_days')::integer, 5),
      'bonus_points', coalesce((v_rules ->> 'bonus_points')::integer, 15),
      'evolution_cap', coalesce((v_rules ->> 'evolution_cap')::integer, 25),
      'volume_cap', coalesce((v_rules ->> 'volume_cap')::integer, 20),
      'met_min_per_point', coalesce((v_rules ->> 'met_min_per_point')::integer, 40),
      'min_baseline_minutes', coalesce((v_rules ->> 'min_baseline_minutes')::integer, 10)),
    'baseline', case when v_baseline.id is null then null else jsonb_build_object(
      'declared_minutes', v_baseline.average_active_minutes,
      'used_minutes', greatest(v_baseline.average_active_minutes,
                               coalesce((v_rules ->> 'min_baseline_minutes')::integer, 10)),
      'frozen', v_baseline.frozen_at is not null) end,
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week_number', w.week_number,
        'completed_days', w.completed_days, 'wildcard_days', w.wildcard_days,
        'consistency', w.consistency_points, 'bonus', w.bonus_points,
        'evolution', w.evolution_points, 'volume', w.volume_points,
        'duel', w.duel_points, 'challenges', w.challenge_points,
        'capped_total', w.total_points,
        'grand_total', w.total_points + w.duel_points + w.challenge_points)
        order by w.week_number)
      from public.weekly_scores w
     where w.user_id = auth.uid() and w.season_id = v_season.id), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', s.started_at::date, 'type', s.activity_type,
        'minutes', round(s.duration_seconds / 60.0, 1),
        'met', case s.activity_type
          when 'Caminhada leve' then 3.5 when 'Caminhada rápida / inclinação' then 5
          when 'Musculação moderada' then 4 when 'Musculação pesada' then 6
          when 'Bike / spinning' then 7 when 'Natação' then 7 when 'Corrida' then 8
          when 'Funcional / HIIT' then 8 when 'Yoga / alongamento' then 2.5 else 1 end,
        'consistency', c.consistency_points, 'evolution', c.evolution_points,
        'volume', c.volume_points) order by s.started_at desc)
      from public.activity_sessions s
      join public.activity_score_contributions c on c.activity_session_id = s.id
     where s.user_id = auth.uid() and s.season_id = v_season.id
     limit 20), '[]'::jsonb));
end;
$$;

create or replace function public.admin_pending_steps()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'full_name', p.full_name, 'step_date', d.step_date,
      'steps', d.steps, 'storage_path', d.storage_path, 'created_at', d.created_at)
      order by d.created_at)
    from public.daily_steps d join public.profiles p on p.id = d.user_id
   where d.status = 'pending_validation'), '[]'::jsonb);
end;
$$;

revoke all on function public.submit_daily_steps(date, integer, text) from public;
revoke all on function public.admin_validate_daily_steps(uuid, boolean, text) from public;
revoke all on function public.my_score_breakdown() from public;
revoke all on function public.admin_pending_steps() from public;

grant execute on function public.submit_daily_steps(date, integer, text) to authenticated;
grant execute on function public.admin_validate_daily_steps(uuid, boolean, text) to authenticated;
grant execute on function public.my_score_breakdown() to authenticated;
grant execute on function public.admin_pending_steps() to authenticated;

commit;

notify pgrst, 'reload schema';