-- 023_wildcards.sql
-- Coringa funcional: protege a consistência sem gerar pontos.
-- Conta como dia presente para o bônus semanal e para o rateio do prêmio.
-- Não conta para pontos, nem para duelo.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- 1. O coringa é para o dia SEM atividade, então a sessão deixa de ser obrigatória.
alter table public.wildcards alter column activity_session_id drop not null;

alter table public.weekly_scores
  add column if not exists wildcard_days integer not null default 0;
alter table public.weekly_scores drop constraint if exists weekly_scores_wildcard_days_check;
alter table public.weekly_scores add constraint weekly_scores_wildcard_days_check
  check (wildcard_days >= 0 and wildcard_days <= 6);

-- 2. Recalcula o bônus considerando dias reais + coringas.
create or replace function public.refresh_weekly_bonus(
  p_user_id uuid, p_season_id uuid, p_week_number integer
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons; v_week_start date;
  v_real integer; v_cards integer; v_bonus_days integer; v_bonus_points integer;
begin
  select * into v_season from public.seasons where id = p_season_id;
  v_week_start := v_season.start_date + ((p_week_number - 1) * 7);
  v_bonus_days := coalesce((v_season.rules ->> 'bonus_days')::integer, 5);
  v_bonus_points := coalesce((v_season.rules ->> 'bonus_points')::integer, 15);

  select count(distinct score_date) into v_real
    from public.activity_score_contributions
   where user_id = p_user_id and season_id = p_season_id
     and score_date between v_week_start and v_week_start + 5
     and consistency_points > 0;

  select count(*) into v_cards
    from public.wildcards
   where user_id = p_user_id and season_id = p_season_id
     and used_on between v_week_start and v_week_start + 5;

  insert into public.weekly_scores (user_id, season_id, week_number, completed_days, wildcard_days, bonus_points)
  values (p_user_id, p_season_id, p_week_number, least(6, coalesce(v_real, 0)),
          least(6, coalesce(v_cards, 0)),
          case when coalesce(v_real,0) + coalesce(v_cards,0) >= v_bonus_days then v_bonus_points else 0 end)
  on conflict (user_id, season_id, week_number) do update
    set completed_days = least(6, coalesce(v_real, 0)),
        wildcard_days = least(6, coalesce(v_cards, 0)),
        bonus_points = case when coalesce(v_real,0) + coalesce(v_cards,0) >= v_bonus_days
                            then v_bonus_points else 0 end,
        updated_at = now();
end;
$$;

-- 3. Usar um coringa num dia perdido.
create or replace function public.use_wildcard(p_used_on date, p_reason text)
returns public.wildcards language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons; v_week integer; v_week_start date; v_row public.wildcards;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(coalesce(p_reason,'')), '') is null or char_length(trim(p_reason)) < 2 then
    raise exception 'escreva o motivo do coringa';
  end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then raise exception 'no active season'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid() and status = 'active') then
    raise exception 'active participation required';
  end if;

  if p_used_on > current_date then raise exception 'não dá para usar coringa em dia futuro'; end if;
  if p_used_on < v_season.start_date or p_used_on > v_season.end_date then
    raise exception 'essa data está fora da temporada';
  end if;
  if current_date - p_used_on > 7 then
    raise exception 'o coringa só vale para os últimos 7 dias';
  end if;

  v_week := public.current_season_week(v_season.id, p_used_on);
  v_week_start := v_season.start_date + ((v_week - 1) * 7);
  if p_used_on > v_week_start + 5 then
    raise exception 'esse dia é o descanso da semana e não precisa de coringa';
  end if;

  if exists (select 1 from public.activity_score_contributions
              where user_id = auth.uid() and season_id = v_season.id
                and score_date = p_used_on and consistency_points > 0) then
    raise exception 'você já concluiu esse dia, não precisa de coringa';
  end if;

  insert into public.wildcards (season_id, user_id, activity_session_id, used_on, reason, context)
  values (v_season.id, auth.uid(), null, p_used_on, trim(p_reason),
          jsonb_build_object('week_number', v_week))
  returning * into v_row;

  perform public.refresh_weekly_bonus(auth.uid(), v_season.id, v_week);

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'wildcard', v_row.id, 'used',
          jsonb_build_object('used_on', p_used_on, 'reason', trim(p_reason)));

  return v_row;
end;
$$;

-- 4. Situação dos coringas e dias em aberto da semana.
create or replace function public.my_wildcards()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons; v_week integer; v_week_start date; v_used integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('season', null); end if;

  v_week := public.current_season_week(v_season.id);
  v_week_start := v_season.start_date + ((v_week - 1) * 7);

  select count(*) into v_used from public.wildcards
   where user_id = auth.uid() and season_id = v_season.id;

  return jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name),
    'used', v_used, 'remaining', greatest(0, 2 - v_used),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('used_on', used_on, 'reason', reason) order by used_on desc)
      from public.wildcards where user_id = auth.uid() and season_id = v_season.id), '[]'::jsonb),
    'open_days', coalesce((
      select jsonb_agg(d order by d)
      from generate_series(greatest(v_week_start, current_date - 7), least(current_date, v_week_start + 5), '1 day') as d
      where not exists (select 1 from public.activity_score_contributions c
                         where c.user_id = auth.uid() and c.season_id = v_season.id
                           and c.score_date = d::date and c.consistency_points > 0)
        and not exists (select 1 from public.wildcards w
                         where w.user_id = auth.uid() and w.season_id = v_season.id
                           and w.used_on = d::date)), '[]'::jsonb));
end;
$$;

-- 5. A pontuação passa a recalcular o bônus pelo caminho compartilhado.
create or replace function public.apply_validated_activity_score(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_activity public.activity_sessions; v_season public.seasons;
  v_baseline public.baseline_metrics; v_rules jsonb;
  v_min_seconds integer; v_min_steps integer; v_per_day integer;
  v_cons_cap integer; v_evo_cap integer; v_vol_cap integer; v_met_per_point integer;
  v_week_number integer; v_week_start date; v_met numeric;
  v_consistency integer; v_evolution integer; v_volume integer; v_contribution_id uuid;
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
  v_evo_cap       := coalesce((v_rules ->> 'evolution_cap')::integer, 25);
  v_vol_cap       := coalesce((v_rules ->> 'volume_cap')::integer, 20);
  v_met_per_point := greatest(1, coalesce((v_rules ->> 'met_min_per_point')::integer, 40));

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

  v_consistency := case when coalesce(v_activity.duration_seconds, 0) >= v_min_seconds
                          or coalesce(v_activity.steps, 0) >= v_min_steps
                        then v_per_day else 0 end;

  v_evolution := case when v_baseline.frozen_at is not null and v_baseline.average_active_minutes > 0
    then least(v_evo_cap, greatest(0, floor(
      (((v_activity.duration_seconds / 60.0) / v_baseline.average_active_minutes - 1) * 100) / 2)::integer))
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

  update public.weekly_scores w
     set consistency_points = t.cons, evolution_points = t.evo,
         volume_points = t.vol, updated_at = now()
    from (select least(v_cons_cap, coalesce(sum(c.consistency_points),0)) as cons,
                 least(v_evo_cap, coalesce(sum(c.evolution_points),0)) as evo,
                 least(v_vol_cap, coalesce(sum(c.volume_points),0)) as vol
            from public.activity_score_contributions c
           where c.user_id = v_activity.user_id and c.season_id = v_activity.season_id
             and c.score_date between v_week_start and v_week_start + 5) t
   where w.user_id = v_activity.user_id and w.season_id = v_activity.season_id
     and w.week_number = v_week_number;

  if not found then
    insert into public.weekly_scores (user_id, season_id, week_number,
      consistency_points, evolution_points, volume_points)
    select v_activity.user_id, v_activity.season_id, v_week_number,
           least(v_cons_cap, coalesce(sum(c.consistency_points),0)),
           least(v_evo_cap, coalesce(sum(c.evolution_points),0)),
           least(v_vol_cap, coalesce(sum(c.volume_points),0))
      from public.activity_score_contributions c
     where c.user_id = v_activity.user_id and c.season_id = v_activity.season_id
       and c.score_date between v_week_start and v_week_start + 5
    on conflict (user_id, season_id, week_number) do nothing;
  end if;

  perform public.refresh_weekly_bonus(v_activity.user_id, v_activity.season_id, v_week_number);
end;
$$;

-- 6. O rateio de consistência passa a somar os coringas.
create or replace function public.compute_season_payout(p_season_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
with season as (select * from public.seasons where id = p_season_id),
prizes as (select * from public.season_prizes where season_id = p_season_id),
meta as (select public.season_total_weeks(p_season_id) as weeks,
                public.season_total_weeks(p_season_id) * 6 as max_days),
pool as (select coalesce(sum(amount), 0) as total from public.payments
          where season_id = p_season_id and payment_status = 'confirmed'),
standing as (
  select w.user_id,
         sum(w.total_points + w.duel_points)::integer as points,
         sum(w.completed_days)::integer as days,
         sum(w.completed_days + w.wildcard_days)::integer as days_with_cards,
         sum(w.consistency_points)::integer as consistency,
         sum(w.evolution_points)::integer as evolution,
         sum(w.volume_points)::integer as volume
    from public.weekly_scores w
    join public.season_participants sp
      on sp.season_id = w.season_id and sp.user_id = w.user_id and sp.status = 'active'
   where w.season_id = p_season_id group by w.user_id),
ranked as (
  select s.*, row_number() over (
    order by s.points desc, s.days desc, s.consistency desc,
             s.evolution desc, s.volume desc, s.user_id) as pos from standing s),
evo as (select user_id from standing where evolution > 0
         order by evolution desc, points desc, user_id limit 1),
qualifiers as (
  select r.user_id from ranked r, meta m, prizes p
   where m.max_days > 0 and (r.days_with_cards * 100.0 / m.max_days) >= p.min_consistency_percent),
awards as (
  select 'champion' as type, 'Campeão' as label, r.user_id,
         round(pool.total * p.champion_percent / 100, 2) as amount
    from ranked r, prizes p, pool where r.pos = 1 and p.champion_percent > 0
  union all
  select 'second', 'Segundo lugar', r.user_id, round(pool.total * p.second_percent / 100, 2)
    from ranked r, prizes p, pool where r.pos = 2 and p.second_percent > 0
  union all
  select 'third', 'Terceiro lugar', r.user_id, round(pool.total * p.third_percent / 100, 2)
    from ranked r, prizes p, pool where r.pos = 3 and p.third_percent > 0
  union all
  select 'evolution', 'Maior evolução', e.user_id, round(pool.total * p.evolution_percent / 100, 2)
    from evo e, prizes p, pool where p.evolution_percent > 0
  union all
  select 'consistency', 'Rateio de consistência', q.user_id,
         round((pool.total * p.consistency_percent / 100) / (select count(*) from qualifiers), 2)
    from qualifiers q, prizes p, pool where p.consistency_percent > 0)
select jsonb_build_object(
  'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status,
                                       'start_date', s.start_date, 'end_date', s.end_date) from season s)
            || (select jsonb_build_object('weeks', weeks, 'max_days', max_days) from meta),
  'pool', (select total from pool),
  'min_consistency_percent', coalesce((select min_consistency_percent from prizes), 80),
  'accumulation', true,
  'standing', coalesce((
    select jsonb_agg(jsonb_build_object(
      'position', r.pos, 'user_id', r.user_id, 'full_name', pr.full_name,
      'avatar_emoji', pr.avatar_emoji, 'points', r.points, 'days', r.days,
      'consistency', r.consistency, 'evolution', r.evolution, 'volume', r.volume,
      'consistency_percent', case when m.max_days > 0
        then round(r.days_with_cards * 100.0 / m.max_days, 1) else 0 end) order by r.pos)
    from ranked r join public.profiles pr on pr.id = r.user_id cross join meta m), '[]'::jsonb),
  'awards', coalesce((
    select jsonb_agg(jsonb_build_object('type', a.type, 'label', a.label,
      'user_id', a.user_id, 'full_name', pr.full_name, 'amount', a.amount))
    from awards a join public.profiles pr on pr.id = a.user_id), '[]'::jsonb));
$$;

revoke all on function public.use_wildcard(date, text) from public;
revoke all on function public.my_wildcards() from public;
revoke all on function public.refresh_weekly_bonus(uuid, uuid, integer) from public;
grant execute on function public.use_wildcard(date, text) to authenticated;
grant execute on function public.my_wildcards() to authenticated;

commit;

notify pgrst, 'reload schema';