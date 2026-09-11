-- 026_weekly_challenges.sql
-- Desafios semanais: catálogo fixo, 3 ativos por semana, rodízio automático.
-- Pontos somam por fora do teto, como os de duelo.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

alter table public.weekly_scores add column if not exists challenge_points integer not null default 0;
alter table public.weekly_scores drop constraint if exists weekly_scores_challenge_points_check;
alter table public.weekly_scores add constraint weekly_scores_challenge_points_check
  check (challenge_points >= 0);

create table if not exists public.challenge_definitions (
  code text primary key,
  name text not null,
  description text not null,
  icon text not null,
  default_points integer not null check (default_points > 0),
  ord integer not null
);

insert into public.challenge_definitions (code, name, description, icon, default_points, ord) values
  ('maratonista','Maratonista','Acumule 150 minutos de atividade na semana','🏃',15,1),
  ('dez-mil','Cinquenta mil','Alcance 50.000 passos na semana','👟',15,2),
  ('folego','Fôlego longo','Faça uma única atividade de 60 minutos','⏱️',10,3),
  ('explorador','Explorador','Registre 3 tipos diferentes de atividade','🧭',10,4),
  ('madrugador','Madrugador','3 atividades antes das 7h','🌅',10,5),
  ('noturno','Noturno','3 atividades depois das 21h','🌙',10,6),
  ('sem-falhar','Sem falhar','Conclua 4 dias seguidos','🔥',15,7),
  ('arena','Arena','Participe de um duelo nesta semana','⚔️',10,8),
  ('superacao','Superação','Supere seu melhor número de dias em uma semana','📈',15,9),
  ('acima-da-media','Acima da média','Faça 20% mais minutos que na semana passada','🚀',15,10)
on conflict (code) do update
  set name = excluded.name, description = excluded.description,
      icon = excluded.icon, ord = excluded.ord;

create table if not exists public.season_challenges (
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 52),
  code text not null references public.challenge_definitions(code),
  points integer not null check (points > 0),
  primary key (season_id, week_number, code)
);

create table if not exists public.challenge_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number integer not null,
  code text not null references public.challenge_definitions(code),
  points integer not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, season_id, week_number, code)
);

alter table public.challenge_definitions enable row level security;
alter table public.season_challenges enable row level security;
alter table public.challenge_completions enable row level security;

drop policy if exists "everyone reads definitions" on public.challenge_definitions;
create policy "everyone reads definitions" on public.challenge_definitions
  for select to authenticated using (true);
drop policy if exists "admins manage definitions" on public.challenge_definitions;
create policy "admins manage definitions" on public.challenge_definitions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "everyone reads season challenges" on public.season_challenges;
create policy "everyone reads season challenges" on public.season_challenges
  for select to authenticated using (true);
drop policy if exists "admins manage season challenges" on public.season_challenges;
create policy "admins manage season challenges" on public.season_challenges
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "participants view own completions" on public.challenge_completions;
create policy "participants view own completions" on public.challenge_completions
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "completions written by rpc" on public.challenge_completions;
create policy "completions written by rpc" on public.challenge_completions
  for insert to authenticated with check (false);
drop policy if exists "admins manage completions" on public.challenge_completions;
create policy "admins manage completions" on public.challenge_completions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Distribui os desafios: 3 por semana, em rodízio pela ordem do catálogo.
create or replace function public.admin_generate_season_challenges(
  p_season_id uuid, p_codes text[] default null
) returns integer language plpgsql security definer set search_path = public as $$
declare
  v_weeks integer; v_list text[]; v_total integer;
  v_week integer; v_slot integer; v_index integer; v_count integer := 0;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select coalesce(p_codes, array_agg(code order by ord)) into v_list
    from public.challenge_definitions;
  v_total := coalesce(array_length(v_list, 1), 0);
  if v_total < 3 then raise exception 'são necessários pelo menos 3 desafios'; end if;

  v_weeks := public.season_total_weeks(p_season_id);
  delete from public.season_challenges where season_id = p_season_id;

  for v_week in 1..v_weeks loop
    for v_slot in 0..2 loop
      v_index := (((v_week - 1) * 3 + v_slot) % v_total) + 1;
      insert into public.season_challenges (season_id, week_number, code, points)
      select p_season_id, v_week, d.code, d.default_points
        from public.challenge_definitions d where d.code = v_list[v_index]
      on conflict do nothing;
      v_count := v_count + 1;
    end loop;
  end loop;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', p_season_id, 'challenges_generated',
          jsonb_build_object('weeks', v_weeks, 'codes', v_list));

  return v_count;
end;
$$;

-- Avalia os desafios da semana corrente e concede o que foi cumprido.
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

  select coalesce(sum(duration_seconds) / 60, 0), coalesce(sum(steps), 0),
         count(distinct activity_type), coalesce(max(duration_seconds), 0),
         count(*) filter (where extract(hour from started_at at time zone 'America/Sao_Paulo') < 7),
         count(*) filter (where extract(hour from started_at at time zone 'America/Sao_Paulo') >= 21)
    into v_minutes, v_steps, v_types, v_longest, v_early, v_late
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and started_at::date between v_start and v_end;

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

  select coalesce(max(completed_days), 0) into v_best_prev
    from public.weekly_scores
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

-- Desafios da semana com progresso.
create or replace function public.my_week_challenges()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons; v_week integer; v_start date; v_end date;
  v_minutes integer; v_steps integer; v_types integer; v_longest integer;
  v_early integer; v_late integer; v_days integer; v_streak integer;
  v_duel integer; v_best_prev integer; v_prev_minutes integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  perform public.evaluate_my_challenges();

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('challenges','[]'::jsonb); end if;

  v_week := public.current_season_week(v_season.id);
  v_start := v_season.start_date + ((v_week - 1) * 7);
  v_end := v_start + 5;

  select coalesce(sum(duration_seconds) / 60, 0), coalesce(sum(steps), 0),
         count(distinct activity_type), coalesce(max(duration_seconds), 0),
         count(*) filter (where extract(hour from started_at at time zone 'America/Sao_Paulo') < 7),
         count(*) filter (where extract(hour from started_at at time zone 'America/Sao_Paulo') >= 21)
    into v_minutes, v_steps, v_types, v_longest, v_early, v_late
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and started_at::date between v_start and v_end;

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

  select count(*) into v_duel from public.duels
   where season_id = v_season.id and week_number = v_week
     and status in ('accepted','finished') and auth.uid() in (challenger_id, opponent_id);

  select coalesce(max(completed_days), 0) into v_best_prev from public.weekly_scores
   where user_id = auth.uid() and season_id = v_season.id and week_number < v_week;

  select coalesce(sum(duration_seconds) / 60, 0) into v_prev_minutes
    from public.activity_sessions
   where user_id = auth.uid() and season_id = v_season.id and status = 'validated'
     and started_at::date between v_start - 7 and v_start - 2;

  return jsonb_build_object(
    'week_number', v_week,
    'days_left', greatest(0, least(6, v_end - greatest(current_date, v_start))),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', d.code, 'name', d.name, 'description', d.description, 'icon', d.icon,
        'points', sc.points,
        'done', cc.code is not null,
        'current', case d.code
          when 'maratonista' then v_minutes when 'dez-mil' then v_steps
          when 'folego' then v_longest / 60 when 'explorador' then v_types
          when 'madrugador' then v_early when 'noturno' then v_late
          when 'sem-falhar' then v_streak when 'arena' then v_duel
          when 'superacao' then v_days when 'acima-da-media' then v_minutes else 0 end,
        'goal', case d.code
          when 'maratonista' then 150 when 'dez-mil' then 50000
          when 'folego' then 60 when 'explorador' then 3
          when 'madrugador' then 3 when 'noturno' then 3
          when 'sem-falhar' then 4 when 'arena' then 1
          when 'superacao' then greatest(1, v_best_prev + 1)
          when 'acima-da-media' then ceil(v_prev_minutes * 1.2)::integer else 1 end,
        'unit', case d.code
          when 'maratonista' then 'min' when 'dez-mil' then 'passos'
          when 'folego' then 'min' when 'acima-da-media' then 'min'
          when 'sem-falhar' then 'dias' when 'superacao' then 'dias' else '' end)
        order by d.ord)
      from public.season_challenges sc
      join public.challenge_definitions d on d.code = sc.code
      left join public.challenge_completions cc
        on cc.user_id = auth.uid() and cc.season_id = v_season.id
       and cc.week_number = v_week and cc.code = sc.code
     where sc.season_id = v_season.id and sc.week_number = v_week), '[]'::jsonb));
end;
$$;

-- O ranking e a premiação passam a somar os pontos de desafio.
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
         sum(w.total_points + w.duel_points + w.challenge_points)::integer as points,
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

revoke all on function public.admin_generate_season_challenges(uuid, text[]) from public;
revoke all on function public.evaluate_my_challenges() from public;
revoke all on function public.my_week_challenges() from public;
grant execute on function public.admin_generate_season_challenges(uuid, text[]) to authenticated;
grant execute on function public.evaluate_my_challenges() to authenticated;
grant execute on function public.my_week_challenges() to authenticated;

commit;

notify pgrst, 'reload schema';