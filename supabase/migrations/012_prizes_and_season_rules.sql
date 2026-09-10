-- 012_prizes_and_season_rules.sql
-- Prêmios por temporada e parâmetros de pontuação travados após a abertura.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- --------------------------------------------- 1. Parâmetros da temporada
-- Semeia as temporadas existentes ANTES de criar a trava, senão o update falha.
update public.seasons
   set rules = jsonb_build_object(
         'daily_minutes', 30,
         'daily_steps', 8000,
         'consistency_per_day', 10,
         'weekly_consistency_cap', 60,
         'bonus_days', 5,
         'bonus_points', 15,
         'evolution_cap', 25,
         'volume_cap', 20,
         'met_min_per_point', 40,
         'duel_points', 10
       )
 where rules is null or rules = '{}'::jsonb;

alter table public.seasons
  alter column rules set default jsonb_build_object(
    'daily_minutes', 30, 'daily_steps', 8000, 'consistency_per_day', 10,
    'weekly_consistency_cap', 60, 'bonus_days', 5, 'bonus_points', 15,
    'evolution_cap', 25, 'volume_cap', 20, 'met_min_per_point', 40, 'duel_points', 10);

create or replace function public.prevent_rules_change_after_draft()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'draft' and new.rules is distinct from old.rules then
    raise exception 'season rules are locked after the season leaves draft';
  end if;
  return new;
end;
$$;

drop trigger if exists seasons_rules_locked on public.seasons;
create trigger seasons_rules_locked before update on public.seasons
  for each row execute function public.prevent_rules_change_after_draft();

create or replace function public.admin_set_season_rules(p_season_id uuid, p_rules jsonb)
returns public.seasons language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_merged jsonb; v_key text;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into v_season from public.seasons where id = p_season_id;
  if v_season.id is null then raise exception 'season not found'; end if;
  if v_season.status <> 'draft' then
    raise exception 'rules can only be changed while the season is a draft';
  end if;

  for v_key in select jsonb_object_keys(p_rules) loop
    if v_key not in ('daily_minutes','daily_steps','consistency_per_day',
                     'weekly_consistency_cap','bonus_days','bonus_points',
                     'evolution_cap','volume_cap','met_min_per_point','duel_points') then
      raise exception 'unknown rule: %', v_key;
    end if;
    if (p_rules ->> v_key) !~ '^[0-9]+$' then
      raise exception 'rule % must be a non-negative integer', v_key;
    end if;
  end loop;

  v_merged := coalesce(v_season.rules, '{}'::jsonb) || p_rules;

  if (v_merged ->> 'daily_minutes')::integer not between 1 and 480 then
    raise exception 'daily_minutes must be between 1 and 480';
  end if;
  if (v_merged ->> 'met_min_per_point')::integer < 1 then
    raise exception 'met_min_per_point must be at least 1';
  end if;

  update public.seasons set rules = v_merged, updated_at = now()
   where id = p_season_id returning * into v_season;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', p_season_id, 'rules_updated', v_merged);

  return v_season;
end;
$$;

-- ------------------------------------------------------- 2. Prêmios
create table if not exists public.season_prizes (
  season_id uuid primary key references public.seasons(id) on delete cascade,
  champion_percent numeric(5,2) not null default 40,
  second_percent numeric(5,2) not null default 20,
  third_percent numeric(5,2) not null default 10,
  evolution_percent numeric(5,2) not null default 15,
  consistency_percent numeric(5,2) not null default 15,
  min_consistency_percent numeric(5,2) not null default 80,
  updated_at timestamptz not null default now(),
  check (champion_percent >= 0 and second_percent >= 0 and third_percent >= 0
     and evolution_percent >= 0 and consistency_percent >= 0),
  check (min_consistency_percent between 0 and 100),
  check (champion_percent + second_percent + third_percent
       + evolution_percent + consistency_percent <= 100)
);

alter table public.season_prizes enable row level security;

drop policy if exists "authenticated users view prizes" on public.season_prizes;
create policy "authenticated users view prizes" on public.season_prizes
  for select to authenticated using (true);

drop policy if exists "admins manage prizes" on public.season_prizes;
create policy "admins manage prizes" on public.season_prizes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.season_prizes (season_id)
select id from public.seasons
on conflict (season_id) do nothing;

create or replace function public.admin_upsert_season_prizes(
  p_season_id uuid, p_champion numeric, p_second numeric, p_third numeric,
  p_evolution numeric, p_consistency numeric, p_min_consistency numeric default 80
) returns public.season_prizes language plpgsql security definer set search_path = public as $$
declare v_row public.season_prizes;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_champion + p_second + p_third + p_evolution + p_consistency > 100 then
    raise exception 'prize percentages cannot exceed 100%%';
  end if;

  insert into public.season_prizes (season_id, champion_percent, second_percent, third_percent,
                                    evolution_percent, consistency_percent, min_consistency_percent)
  values (p_season_id, p_champion, p_second, p_third, p_evolution, p_consistency, p_min_consistency)
  on conflict (season_id) do update
    set champion_percent = excluded.champion_percent,
        second_percent = excluded.second_percent,
        third_percent = excluded.third_percent,
        evolution_percent = excluded.evolution_percent,
        consistency_percent = excluded.consistency_percent,
        min_consistency_percent = excluded.min_consistency_percent,
        updated_at = now()
  returning * into v_row;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', p_season_id, 'prizes_updated', to_jsonb(v_row));

  return v_row;
end;
$$;

-- ------------------------------- 3. Pontuação passa a ler os parâmetros
create or replace function public.apply_validated_activity_score(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_activity public.activity_sessions;
  v_season public.seasons;
  v_baseline public.baseline_metrics;
  v_rules jsonb;
  v_min_seconds integer; v_min_steps integer; v_per_day integer;
  v_cons_cap integer; v_bonus_days integer; v_bonus_points integer;
  v_evo_cap integer; v_vol_cap integer; v_met_per_point integer;
  v_week_number integer; v_week_start date;
  v_met numeric;
  v_consistency integer; v_evolution integer; v_volume integer;
  v_completed_days integer; v_contribution_id uuid;
begin
  select * into v_activity from public.activity_sessions
   where id = p_session_id and status = 'validated';
  if v_activity.id is null then raise exception 'validated activity not found'; end if;

  select * into v_season from public.seasons where id = v_activity.season_id;
  v_rules := coalesce(v_season.rules, '{}'::jsonb);

  v_min_seconds   := coalesce((v_rules ->> 'daily_minutes')::integer, 30) * 60;
  v_min_steps     := coalesce((v_rules ->> 'daily_steps')::integer, 8000);
  v_per_day       := coalesce((v_rules ->> 'consistency_per_day')::integer, 10);
  v_cons_cap      := coalesce((v_rules ->> 'weekly_consistency_cap')::integer, 60);
  v_bonus_days    := coalesce((v_rules ->> 'bonus_days')::integer, 5);
  v_bonus_points  := coalesce((v_rules ->> 'bonus_points')::integer, 15);
  v_evo_cap       := coalesce((v_rules ->> 'evolution_cap')::integer, 25);
  v_vol_cap       := coalesce((v_rules ->> 'volume_cap')::integer, 20);
  v_met_per_point := greatest(1, coalesce((v_rules ->> 'met_min_per_point')::integer, 40));

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
    when coalesce(v_activity.duration_seconds, 0) >= v_min_seconds
      or coalesce(v_activity.steps, 0) >= v_min_steps
    then v_per_day else 0 end;

  v_evolution := case
    when v_baseline.frozen_at is not null and v_baseline.average_active_minutes > 0
    then least(v_evo_cap, greatest(0, floor(
      (((v_activity.duration_seconds / 60.0) / v_baseline.average_active_minutes - 1) * 100) / 2
    )::integer))
    else 0 end;

  v_volume := least(v_vol_cap,
    floor((v_met * coalesce(v_activity.duration_seconds, 0) / 60) / v_met_per_point)::integer);

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
   where c.user_id = v_activity.user_id and c.season_id = v_activity.season_id
     and c.score_date between v_week_start and v_week_start + 5
     and c.consistency_points >= v_per_day;

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
        volume_points = excluded.volume_points,
        calculated_at = now();

  insert into public.weekly_scores
    (user_id, season_id, week_number, consistency_points, evolution_points,
     volume_points, bonus_points, completed_days)
  select v_activity.user_id, v_activity.season_id, v_week_number,
         least(v_cons_cap, coalesce(sum(c.consistency_points), 0)),
         least(v_evo_cap, coalesce(sum(c.evolution_points), 0)),
         least(v_vol_cap, coalesce(sum(c.volume_points), 0)),
         case when v_completed_days >= v_bonus_days then v_bonus_points else 0 end,
         least(6, v_completed_days)
    from public.activity_score_contributions c
   where c.user_id = v_activity.user_id and c.season_id = v_activity.season_id
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

-- ------------------------- 4. Duelo passa a ler os pontos dos parâmetros
create or replace function public.resolve_finished_duels()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels; v_season public.seasons; v_week_start date;
  v_c_days integer; v_o_days integer;
  v_c_cons integer; v_o_cons integer;
  v_c_vol integer;  v_o_vol integer;
  v_winner uuid; v_points integer; v_count integer := 0;
begin
  perform public.expire_stale_duels();

  for v_duel in
    select d.* from public.duels d
     join public.seasons s on s.id = d.season_id
    where d.status = 'accepted'
      and current_date > s.start_date + ((d.week_number - 1) * 7) + 5
    for update
  loop
    select * into v_season from public.seasons where id = v_duel.season_id;
    v_week_start := v_season.start_date + ((v_duel.week_number - 1) * 7);
    v_points := greatest(0, coalesce((v_season.rules ->> 'duel_points')::integer, 10));

    select count(distinct c.score_date) filter (where c.consistency_points > 0),
           coalesce(sum(c.consistency_points), 0), coalesce(sum(c.volume_points), 0)
      into v_c_days, v_c_cons, v_c_vol
      from public.activity_score_contributions c
     where c.user_id = v_duel.challenger_id and c.season_id = v_duel.season_id
       and c.score_date between v_week_start and v_week_start + 5;

    select count(distinct c.score_date) filter (where c.consistency_points > 0),
           coalesce(sum(c.consistency_points), 0), coalesce(sum(c.volume_points), 0)
      into v_o_days, v_o_cons, v_o_vol
      from public.activity_score_contributions c
     where c.user_id = v_duel.opponent_id and c.season_id = v_duel.season_id
       and c.score_date between v_week_start and v_week_start + 5;

    v_c_days := coalesce(v_c_days, 0); v_o_days := coalesce(v_o_days, 0);

    v_winner := case
      when v_c_days > v_o_days then v_duel.challenger_id
      when v_o_days > v_c_days then v_duel.opponent_id
      when v_c_cons > v_o_cons then v_duel.challenger_id
      when v_o_cons > v_c_cons then v_duel.opponent_id
      when v_c_vol > v_o_vol then v_duel.challenger_id
      when v_o_vol > v_c_vol then v_duel.opponent_id
      else null end;

    if v_winner is not null and v_points > 0 then
      insert into public.weekly_scores (user_id, season_id, week_number, duel_points)
      values (v_winner, v_duel.season_id, v_duel.week_number, v_points)
      on conflict (user_id, season_id, week_number) do update
        set duel_points = public.weekly_scores.duel_points + v_points, updated_at = now();
    end if;

    update public.duels
       set status = 'finished', resolved_at = now(), winner_id = v_winner,
           challenger_days = v_c_days, opponent_days = v_o_days,
           points_awarded = case when v_winner is null then 0 else v_points end
     where id = v_duel.id;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (null, 'duel', v_duel.id, 'resolved',
            jsonb_build_object('winner_id', v_winner,
                               'challenger_days', v_c_days, 'opponent_days', v_o_days));

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.admin_set_season_rules(uuid, jsonb) from public;
revoke all on function public.admin_upsert_season_prizes(uuid, numeric, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function public.admin_set_season_rules(uuid, jsonb) to authenticated;
grant execute on function public.admin_upsert_season_prizes(uuid, numeric, numeric, numeric, numeric, numeric, numeric) to authenticated;

commit;

notify pgrst, 'reload schema';