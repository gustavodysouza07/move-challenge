-- 011_duels.sql
-- Duelos entre participantes: proposta, aceite/recusa, apuração automática.
-- Vitória = mais dias concluídos na semana. Pontos ficam FORA do teto de 120.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ------------------------------------------------------------- 1. Estrutura
do $$ begin
  create type public.duel_status as enum ('pending','accepted','declined','expired','finished');
exception when duplicate_object then null; end $$;

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 8),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  status public.duel_status not null default 'pending',
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  resolved_at timestamptz,
  winner_id uuid references public.profiles(id),
  challenger_days integer,
  opponent_days integer,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  check (challenger_id <> opponent_id)
);

create index if not exists duels_season_week_idx on public.duels(season_id, week_number, status);
create index if not exists duels_challenger_idx on public.duels(challenger_id, status);
create index if not exists duels_opponent_idx on public.duels(opponent_id, status);

-- Pontos de duelo ficam fora de total_points (gerado com teto de 120).
alter table public.weekly_scores
  add column if not exists duel_points integer not null default 0;
alter table public.weekly_scores drop constraint if exists weekly_scores_duel_points_check;
alter table public.weekly_scores add constraint weekly_scores_duel_points_check
  check (duel_points >= 0);

alter table public.duels enable row level security;

drop policy if exists "participants view own duels" on public.duels;
create policy "participants view own duels" on public.duels
  for select to authenticated
  using (challenger_id = auth.uid() or opponent_id = auth.uid() or public.is_admin());

drop policy if exists "participants cannot write duels" on public.duels;
create policy "participants cannot write duels" on public.duels
  for insert to authenticated with check (false);

drop policy if exists "admins manage duels" on public.duels;
create policy "admins manage duels" on public.duels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------- 2. Semana corrente
create or replace function public.current_season_week(p_season_id uuid, p_date date default current_date)
returns integer language sql stable set search_path = public as $$
  select greatest(1, least(8, floor((p_date - s.start_date)::numeric / 7)::integer + 1))
  from public.seasons s where s.id = p_season_id;
$$;

-- --------------------------------------------------------- 3. Propor duelo
create or replace function public.propose_duel(p_opponent_id uuid)
returns public.duels language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons;
  v_week integer;
  v_week_start date;
  v_duel public.duels;
  v_pair_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_opponent_id = auth.uid() then raise exception 'you cannot duel yourself'; end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then raise exception 'no active season'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid() and status = 'active')
  then raise exception 'active participation required'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = p_opponent_id and status = 'active')
  then raise exception 'opponent is not an active participant'; end if;

  v_week := public.current_season_week(v_season.id);
  v_week_start := v_season.start_date + ((v_week - 1) * 7);

  -- Precisa sobrar tempo de competição: só nos quatro primeiros dias da semana.
  if current_date > v_week_start + 3 then
    raise exception 'duels can only be proposed in the first four days of the week';
  end if;

  if exists (select 1 from public.duels
              where season_id = v_season.id and week_number = v_week
                and status in ('pending','accepted')
                and auth.uid() in (challenger_id, opponent_id))
  then raise exception 'you already have a duel this week'; end if;

  if exists (select 1 from public.duels
              where season_id = v_season.id and week_number = v_week
                and status in ('pending','accepted')
                and p_opponent_id in (challenger_id, opponent_id))
  then raise exception 'this participant already has a duel this week'; end if;

  select count(*) into v_pair_count from public.duels
   where season_id = v_season.id
     and status in ('accepted','finished')
     and ((challenger_id = auth.uid() and opponent_id = p_opponent_id)
       or (challenger_id = p_opponent_id and opponent_id = auth.uid()));
  if v_pair_count >= 2 then
    raise exception 'you already dueled this participant twice this season';
  end if;

  insert into public.duels (season_id, week_number, challenger_id, opponent_id, expires_at)
  values (v_season.id, v_week, auth.uid(), p_opponent_id, now() + interval '24 hours')
  returning * into v_duel;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'duel', v_duel.id, 'proposed',
          jsonb_build_object('opponent_id', p_opponent_id, 'week_number', v_week));

  return v_duel;
end;
$$;

-- ------------------------------------------------- 4. Aceitar ou recusar
create or replace function public.respond_duel(p_duel_id uuid, p_accept boolean)
returns public.duels language plpgsql security definer set search_path = public as $$
declare v_duel public.duels;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_duel from public.duels
   where id = p_duel_id and opponent_id = auth.uid() for update;
  if v_duel.id is null then raise exception 'duel not found'; end if;
  if v_duel.status <> 'pending' then raise exception 'duel is no longer pending'; end if;

  if v_duel.expires_at < now() then
    update public.duels set status = 'expired', resolved_at = now()
     where id = v_duel.id returning * into v_duel;
    raise exception 'duel invitation expired';
  end if;

  update public.duels
     set status = case when p_accept then 'accepted'::public.duel_status
                                     else 'declined'::public.duel_status end,
         responded_at = now(),
         resolved_at = case when p_accept then null else now() end
   where id = v_duel.id returning * into v_duel;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'duel', v_duel.id,
          case when p_accept then 'accepted' else 'declined' end, '{}'::jsonb);

  return v_duel;
end;
$$;

-- ----------------------------------------- 5. Expirar convites sem resposta
create or replace function public.expire_stale_duels()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.duels set status = 'expired', resolved_at = now()
   where status = 'pending' and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ------------------------------------------------ 6. Apurar duelos da semana
-- Só processa semanas encerradas. Idempotente: duelo já finalizado é ignorado.
create or replace function public.resolve_finished_duels()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_season public.seasons;
  v_week_start date;
  v_c_days integer; v_o_days integer;
  v_c_cons integer; v_o_cons integer;
  v_c_vol integer;  v_o_vol integer;
  v_winner uuid;
  v_points constant integer := 10;
  v_count integer := 0;
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

    select count(distinct c.score_date) filter (where c.consistency_points >= 10),
           coalesce(sum(c.consistency_points), 0), coalesce(sum(c.volume_points), 0)
      into v_c_days, v_c_cons, v_c_vol
      from public.activity_score_contributions c
     where c.user_id = v_duel.challenger_id and c.season_id = v_duel.season_id
       and c.score_date between v_week_start and v_week_start + 5;

    select count(distinct c.score_date) filter (where c.consistency_points >= 10),
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

    if v_winner is not null then
      insert into public.weekly_scores (user_id, season_id, week_number, duel_points)
      values (v_winner, v_duel.season_id, v_duel.week_number, v_points)
      on conflict (user_id, season_id, week_number) do update
        set duel_points = public.weekly_scores.duel_points + v_points,
            updated_at = now();
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

-- --------------------------------------------- 7. Sugestão de adversários
create or replace function public.suggest_duel_opponents(p_limit integer default 5)
returns table (user_id uuid, full_name text, avatar_emoji text, last_week_points integer)
language plpgsql security definer set search_path = public as $$
declare