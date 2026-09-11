-- 016_payout_and_flexible_duration.sql
-- a) duração da temporada deixa de ser fixa em 8 semanas;
-- b) apuração do rateio dos prêmios, com acúmulo de categorias.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ------------------------------------------------- 1. Duração flexível
create or replace function public.season_total_weeks(p_season_id uuid)
returns integer language sql stable set search_path = public as $$
  select greatest(1, least(52, ceil(((s.end_date - s.start_date) + 1) / 7.0)::integer))
  from public.seasons s where s.id = p_season_id;
$$;

alter table public.weekly_scores drop constraint if exists weekly_scores_week_number_check;
alter table public.weekly_scores add constraint weekly_scores_week_number_check
  check (week_number between 1 and 52);

create or replace function public.current_season_week(p_season_id uuid, p_date date default current_date)
returns integer language sql stable set search_path = public as $$
  select greatest(1, least(public.season_total_weeks(p_season_id),
                           floor((p_date - s.start_date)::numeric / 7)::integer + 1))
  from public.seasons s where s.id = p_season_id;
$$;

-- ------------------------------------------------- 2. Apuração do rateio
-- Acúmulo permitido: quem vence o pódio pode também levar a fatia de maior
-- evolução e entrar no rateio de consistência.
create or replace function public.season_payout(p_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons;
  v_prizes public.season_prizes;
  v_pool numeric;
  v_weeks integer;
  v_max_days integer;
  v_champion uuid; v_second uuid; v_third uuid; v_evolution uuid;
  v_qualifiers uuid[];
  v_share numeric;
  v_awards jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into v_season from public.seasons where id = p_season_id;
  if v_season.id is null then raise exception 'season not found'; end if;

  select * into v_prizes from public.season_prizes where season_id = p_season_id;
  if v_prizes.season_id is null then raise exception 'season prizes not configured'; end if;

  v_weeks := public.season_total_weeks(p_season_id);
  v_max_days := v_weeks * 6;

  select coalesce(sum(amount), 0) into v_pool
    from public.payments
   where season_id = p_season_id and payment_status = 'confirmed';

  create temp table _standing on commit drop as
  select w.user_id,
         sum(w.total_points + w.duel_points)::integer as points,
         sum(w.completed_days)::integer as days,
         sum(w.consistency_points)::integer as consistency,
         sum(w.evolution_points)::integer as evolution,
         sum(w.volume_points)::integer as volume
    from public.weekly_scores w
    join public.season_participants sp
      on sp.season_id = w.season_id and sp.user_id = w.user_id and sp.status = 'active'
   where w.season_id = p_season_id
   group by w.user_id;

  select user_id into v_champion from _standing
   order by points desc, days desc, consistency desc, evolution desc, volume desc, user_id
   offset 0 limit 1;
  select user_id into v_second from _standing
   order by points desc, days desc, consistency desc, evolution desc, volume desc, user_id
   offset 1 limit 1;
  select user_id into v_third from _standing
   order by points desc, days desc, consistency desc, evolution desc, volume desc, user_id
   offset 2 limit 1;

  select user_id into v_evolution from _standing
   where evolution > 0
   order by evolution desc, points desc, user_id limit 1;

  select coalesce(array_agg(user_id), '{}') into v_qualifiers
    from _standing
   where v_max_days > 0
     and (days * 100.0 / v_max_days) >= v_prizes.min_consistency_percent;

  if v_champion is not null and v_prizes.champion_percent > 0 then
    v_awards := v_awards || jsonb_build_array(jsonb_build_object(
      'type', 'champion', 'label', 'Campeão', 'user_id', v_champion,
      'amount', round(v_pool * v_prizes.champion_percent / 100, 2)));
  end if;
  if v_second is not null and v_prizes.second_percent > 0 then
    v_awards := v_awards || jsonb_build_array(jsonb_build_object(
      'type', 'second', 'label', 'Segundo lugar', 'user_id', v_second,
      'amount', round(v_pool * v_prizes.second_percent / 100, 2)));
  end if;
  if v_third is not null and v_prizes.third_percent > 0 then
    v_awards := v_awards || jsonb_build_array(jsonb_build_object(
      'type', 'third', 'label', 'Terceiro lugar', 'user_id', v_third,
      'amount', round(v_pool * v_prizes.third_percent / 100, 2)));
  end if;
  if v_evolution is not null and v_prizes.evolution_percent > 0 then
    v_awards := v_awards || jsonb_build_array(jsonb_build_object(
      'type', 'evolution', 'label', 'Maior evolução', 'user_id', v_evolution,
      'amount', round(v_pool * v_prizes.evolution_percent / 100, 2)));
  end if;

  if array_length(v_qualifiers, 1) > 0 and v_prizes.consistency_percent > 0 then
    v_share := round((v_pool * v_prizes.consistency_percent / 100)
                     / array_length(v_qualifiers, 1), 2);
    v_awards := v_awards || (
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', 'consistency', 'label', 'Rateio de consistência',
        'user_id', u, 'amount', v_share)), '[]'::jsonb)
      from unnest(v_qualifiers) as u);
  end if;

  return jsonb_build_object(
    'season', jsonb_build_object('id', v_season.id, 'name', v_season.name,
                                 'status', v_season.status, 'weeks', v_weeks,
                                 'max_days', v_max_days),
    'pool', v_pool,
    'min_consistency_percent', v_prizes.min_consistency_percent,
    'accumulation', true,
    'standing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', s.user_id, 'full_name', p.full_name, 'avatar_emoji', p.avatar_emoji,
        'points', s.points, 'days', s.days, 'consistency', s.consistency,
        'evolution', s.evolution, 'volume', s.volume,
        'consistency_percent', case when v_max_days > 0
          then round(s.days * 100.0 / v_max_days, 1) else 0 end)
        order by s.points desc, s.days desc, s.consistency desc, s.user_id)
      from _standing s join public.profiles p on p.id = s.user_id), '[]'::jsonb),
    'awards', coalesce((
      select jsonb_agg(a || jsonb_build_object('full_name', p.full_name))
      from jsonb_array_elements(v_awards) a
      join public.profiles p on p.id = (a ->> 'user_id')::uuid), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.season_payout(uuid) from public;
revoke all on function public.season_total_weeks(uuid) from public;
grant execute on function public.season_payout(uuid) to authenticated;
grant execute on function public.season_total_weeks(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';