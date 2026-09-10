-- 010_fix_score_variable_conflict.sql
-- Corrige "column reference week_number is ambiguous" ao aprovar atividade.
-- As variáveis do PL/pgSQL tinham o mesmo nome de colunas de weekly_scores.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create or replace function public.apply_validated_activity_score(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_activity public.activity_sessions;
  v_season public.seasons;
  v_baseline public.baseline_metrics;
  v_week_number integer;
  v_week_start date;
  v_met numeric;
  v_consistency integer;
  v_evolution integer;
  v_volume integer;
  v_completed_days integer;
  v_contribution_id uuid;
begin
  select * into v_activity from public.activity_sessions
   where id = p_session_id and status = 'validated';
  if v_activity.id is null then raise exception 'validated activity not found'; end if;

  select * into v_season from public.seasons where id = v_activity.season_id;

  v_week_number := greatest(1, least(8,
    floor((v_activity.started_at::date - v_season.start_date)::numeric / 7)::integer + 1));
  v_week_start := v_season.start_date + ((v_week_number - 1) * 7);

  if v_activity.started_at::date < v_week_start
     or v_activity.started_at::date > v_week_start + 5 then
    return;
  end if;

  select * into v_baseline from public.baseline_metrics
   where season_id = v_activity.season_id and user_id = v_activity.user_id;

  v_met := case v_activity.activity_type
    when 'Caminhada leve' then 3.5
    when 'Caminhada rápida / inclinação' then 5
    when 'Musculação moderada' then 4
    when 'Musculação pesada' then 6
    when 'Bike / spinning' then 7
    when 'Natação' then 7
    when 'Corrida' then 8
    when 'Funcional / HIIT' then 8
    when 'Yoga / alongamento' then 2.5
    else 1 end;

  v_consistency := case
    when coalesce(v_activity.duration_seconds, 0) >= 1800
      or coalesce(v_activity.steps, 0) >= 8000
    then 10 else 0 end;

  v_evolution := case
    when v_baseline.frozen_at is not null and v_baseline.average_active_minutes > 0
    then least(25, greatest(0, floor(
      (((v_activity.duration_seconds / 60.0) / v_baseline.average_active_minutes - 1) * 100) / 2
    )::integer))
    else 0 end;

  v_volume := least(20, floor((v_met * coalesce(v_activity.duration_seconds, 0) / 60) / 40)::integer);

  insert into public.activity_score_contributions
    (activity_session_id, user_id, season_id, score_date,
     consistency_points, evolution_points, volume_points)
  values
    (v_activity.id, v_activity.user_id, v_activity.season_id, v_activity.started_at::date,
     v_consistency, v_evolution, v_volume)
  on conflict (activity_session_id) do nothing
  returning id into v_contribution_id;

  if v_contribution_id is null then return; end if;

  select count(distinct c.score_date) into v_completed_days
    from public.activity_score_contributions c
   where c.user_id = v_activity.user_id
     and c.season_id = v_activity.season_id
     and c.score_date between v_week_start and v_week_start + 5
     and c.consistency_points >= 10;

  insert into public.daily_scores
    (user_id, season_id, score_date, consistency_points, evolution_points, volume_points)
  select v_activity.user_id, v_activity.season_id, c.score_date,
         least(10, sum(c.consistency_points)),
         least(25, sum(c.evolution_points)),
         least(20, sum(c.volume_points))
    from public.activity_score_contributions c
   where c.user_id = v_activity.user_id
     and c.season_id = v_activity.season_id
     and c.score_date = v_activity.started_at::date
   group by c.score_date
  on conflict (user_id, season_id, score_date) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points,
        calculated_at = now();

  insert into public.weekly_scores
    (user_id, season_id, week_number, consistency_points, evolution_points,
     volume_points, bonus_points, completed_days)
  select v_activity.user_id, v_activity.season_id, v_week_number,
         least(60, coalesce(sum(c.consistency_points), 0)),
         least(25, coalesce(sum(c.evolution_points), 0)),
         least(20, coalesce(sum(c.volume_points), 0)),
         case when v_completed_days >= 5 then 15 else 0 end,
         least(6, v_completed_days)
    from public.activity_score_contributions c
   where c.user_id = v_activity.user_id
     and c.season_id = v_activity.season_id
     and c.score_date between v_week_start and v_week_start + 5
  on conflict (user_id, season_id, week_number) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points,
        bonus_points = excluded.bonus_points,
        completed_days = excluded.completed_days,
        updated_at = now();
end;
$$;

commit;

notify pgrst, 'reload schema';