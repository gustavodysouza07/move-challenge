-- 019_baseline_and_forfeit.sql
-- a) Semana 0: participante registra a própria média antes da temporada;
--    o admin congela na abertura, e é contra esse número que a evolução compara.
-- b) Desistência de duelo.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ------------------------------------------------------ 1. Baseline
create or replace function public.upsert_baseline(
  p_average_active_minutes numeric, p_average_steps numeric
) returns public.baseline_metrics language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_row public.baseline_metrics;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  if p_average_active_minutes is null or p_average_active_minutes < 0 or p_average_active_minutes > 480 then
    raise exception 'average active minutes must be between 0 and 480';
  end if;
  if p_average_steps is null or p_average_steps < 0 or p_average_steps > 100000 then
    raise exception 'average steps must be between 0 and 100000';
  end if;

  select * into v_season from public.seasons
   where status in ('registration', 'active')
   order by start_date limit 1;
  if v_season.id is null then raise exception 'no season open for baseline'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid()) then
    raise exception 'request participation before setting your baseline';
  end if;

  if exists (select 1 from public.baseline_metrics
              where season_id = v_season.id and user_id = auth.uid()
                and frozen_at is not null) then
    raise exception 'your baseline is already locked for this season';
  end if;

  insert into public.baseline_metrics (
    season_id, user_id, average_active_minutes, average_steps,
    baseline_period_start, baseline_period_end)
  values (
    v_season.id, auth.uid(), p_average_active_minutes, p_average_steps,
    v_season.start_date - 14, v_season.start_date - 1)
  on conflict (season_id, user_id) do update
    set average_active_minutes = excluded.average_active_minutes,
        average_steps = excluded.average_steps,
        updated_at = now()
  returning * into v_row;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'baseline', v_row.id, 'saved',
          jsonb_build_object('minutes', p_average_active_minutes, 'steps', p_average_steps));

  return v_row;
end;
$$;

create or replace function public.my_baseline()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_row public.baseline_metrics;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_season from public.seasons
   where status in ('registration', 'active') order by start_date limit 1;
  if v_season.id is null then return jsonb_build_object('season', null); end if;

  select * into v_row from public.baseline_metrics
   where season_id = v_season.id and user_id = auth.uid();

  return jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name,
                                 'status', v_season.status, 'start_date', v_season.start_date),
    'baseline', case when v_row.id is null then null else jsonb_build_object(
      'average_active_minutes', v_row.average_active_minutes,
      'average_steps', v_row.average_steps,
      'frozen_at', v_row.frozen_at) end);
end;
$$;

create or replace function public.admin_freeze_baselines(p_season_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  update public.baseline_metrics set frozen_at = now(), updated_at = now()
   where season_id = p_season_id and frozen_at is null;
  get diagnostics v_count = row_count;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', p_season_id, 'baselines_frozen',
          jsonb_build_object('count', v_count));

  return v_count;
end;
$$;

-- ------------------------------------------------------ 2. Desistência
alter table public.duels add column if not exists forfeited_by uuid references public.profiles(id);

create or replace function public.forfeit_duel(p_duel_id uuid)
returns public.duels language plpgsql security definer set search_path = public as $$
declare v_duel public.duels; v_season public.seasons; v_points integer; v_winner uuid;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_duel from public.duels where id = p_duel_id for update;
  if v_duel.id is null then raise exception 'duel not found'; end if;
  if auth.uid() not in (v_duel.challenger_id, v_duel.opponent_id) then
    raise exception 'not your duel';
  end if;
  if v_duel.status <> 'accepted' then raise exception 'duel is not in progress'; end if;

  select * into v_season from public.seasons where id = v_duel.season_id;
  v_points := greatest(0, coalesce((v_season.rules ->> 'duel_points')::integer, 10));
  v_winner := case when auth.uid() = v_duel.challenger_id
                   then v_duel.opponent_id else v_duel.challenger_id end;

  if v_points > 0 then
    insert into public.weekly_scores (user_id, season_id, week_number, duel_points)
    values (v_winner, v_duel.season_id, v_duel.week_number, v_points)
    on conflict (user_id, season_id, week_number) do update
      set duel_points = public.weekly_scores.duel_points + v_points, updated_at = now();
  end if;

  update public.duels
     set status = 'finished', resolved_at = now(), winner_id = v_winner,
         forfeited_by = auth.uid(), points_awarded = v_points
   where id = p_duel_id returning * into v_duel;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'duel', p_duel_id, 'forfeited',
          jsonb_build_object('winner_id', v_winner));

  return v_duel;
end;
$$;

revoke all on function public.upsert_baseline(numeric, numeric) from public;
revoke all on function public.my_baseline() from public;
revoke all on function public.admin_freeze_baselines(uuid) from public;
revoke all on function public.forfeit_duel(uuid) from public;

grant execute on function public.upsert_baseline(numeric, numeric) to authenticated;
grant execute on function public.my_baseline() to authenticated;
grant execute on function public.admin_freeze_baselines(uuid) to authenticated;
grant execute on function public.forfeit_duel(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';