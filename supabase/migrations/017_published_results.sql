-- 017_published_results.sql
-- Resultado publicado da temporada: instantâneo congelado e visível a todos.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create table if not exists public.season_results (
  season_id uuid primary key references public.seasons(id) on delete cascade,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id),
  payload jsonb not null
);

alter table public.season_results enable row level security;

drop policy if exists "authenticated users view results" on public.season_results;
create policy "authenticated users view results" on public.season_results
  for select to authenticated using (true);

drop policy if exists "admins manage results" on public.season_results;
create policy "admins manage results" on public.season_results
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cálculo compartilhado entre a prévia e a publicação.
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
         sum(w.consistency_points)::integer as consistency,
         sum(w.evolution_points)::integer as evolution,
         sum(w.volume_points)::integer as volume
    from public.weekly_scores w
    join public.season_participants sp
      on sp.season_id = w.season_id and sp.user_id = w.user_id and sp.status = 'active'
   where w.season_id = p_season_id
   group by w.user_id),
ranked as (
  select s.*, row_number() over (
    order by s.points desc, s.days desc, s.consistency desc,
             s.evolution desc, s.volume desc, s.user_id) as pos
  from standing s),
evo as (select user_id from standing where evolution > 0
         order by evolution desc, points desc, user_id limit 1),
qualifiers as (
  select r.user_id from ranked r, meta m, prizes p
   where m.max_days > 0 and (r.days * 100.0 / m.max_days) >= p.min_consistency_percent),
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
         round((pool.total * p.consistency_percent / 100)
               / (select count(*) from qualifiers), 2)
    from qualifiers q, prizes p, pool where p.consistency_percent > 0)
select jsonb_build_object(
  'season', (select jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status,
                                       'start_date', s.start_date, 'end_date', s.end_date)
               from season s)
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
        then round(r.days * 100.0 / m.max_days, 1) else 0 end) order by r.pos)
    from ranked r join public.profiles pr on pr.id = r.user_id cross join meta m), '[]'::jsonb),
  'awards', coalesce((
    select jsonb_agg(jsonb_build_object('type', a.type, 'label', a.label,
      'user_id', a.user_id, 'full_name', pr.full_name, 'amount', a.amount))
    from awards a join public.profiles pr on pr.id = a.user_id), '[]'::jsonb));
$$;

create or replace function public.season_payout(p_season_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  insert into public.season_prizes (season_id) values (p_season_id) on conflict do nothing;
  return public.compute_season_payout(p_season_id);
end;
$$;

create or replace function public.publish_season_payout(p_season_id uuid)
returns public.season_results language plpgsql security definer set search_path = public as $$
declare v_payload jsonb; v_row public.season_results;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  insert into public.season_prizes (season_id) values (p_season_id) on conflict do nothing;
  v_payload := public.compute_season_payout(p_season_id);

  insert into public.season_results (season_id, published_by, payload)
  values (p_season_id, auth.uid(), v_payload)
  on conflict (season_id) do update
    set payload = excluded.payload, published_by = auth.uid(), published_at = now()
  returning * into v_row;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', p_season_id, 'results_published',
          jsonb_build_object('pool', v_payload -> 'pool'));

  return v_row;
end;
$$;

revoke all on function public.compute_season_payout(uuid) from public;
revoke all on function public.publish_season_payout(uuid) from public;
grant execute on function public.compute_season_payout(uuid) to authenticated;
grant execute on function public.publish_season_payout(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';