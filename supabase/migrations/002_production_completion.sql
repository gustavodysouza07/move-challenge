-- MOVE Challenge incremental production completion migration.
-- Apply after the original supabase/schema.sql. This file is intentionally not self-contained.

alter table public.seasons add column if not exists rules jsonb not null default '{}'::jsonb;
alter table public.seasons add column if not exists prize_config jsonb not null default '{}'::jsonb;
alter table public.seasons add column if not exists pix_key text;
alter table public.activity_sessions add column if not exists paused_seconds integer not null default 0 check (paused_seconds >= 0);

create table if not exists public.activity_pauses (
  id uuid primary key default gen_random_uuid(),
  activity_session_id uuid not null references public.activity_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pause_started_at timestamptz not null default now(),
  pause_ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (pause_ended_at is null or pause_ended_at >= pause_started_at)
);
create unique index if not exists activity_pauses_one_open_idx on public.activity_pauses(activity_session_id) where pause_ended_at is null;
create index if not exists activity_pauses_session_idx on public.activity_pauses(activity_session_id, pause_started_at);

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text,
  objective numeric(12,2) not null check (objective > 0),
  points integer not null check (points >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_active boolean not null default true,
  badge_name text,
  badge_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.challenge_progress (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  progress numeric(12,2) not null default 0 check (progress >= 0),
  status text not null default 'joined' check (status in ('joined', 'in_progress', 'completed')),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (challenge_id, user_id)
);

create table if not exists public.season_prizes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null unique references public.seasons(id) on delete cascade,
  award_percent numeric(5,2) check (award_percent is null or award_percent between 0 and 100),
  award_amount numeric(12,2) check (award_amount is null or award_amount >= 0),
  champion_amount numeric(12,2) not null default 0 check (champion_amount >= 0),
  second_amount numeric(12,2) not null default 0 check (second_amount >= 0),
  third_amount numeric(12,2) not null default 0 check (third_amount >= 0),
  evolution_amount numeric(12,2) not null default 0 check (evolution_amount >= 0),
  consistency_amount numeric(12,2) not null default 0 check (consistency_amount >= 0),
  min_consistency_percent numeric(5,2) not null default 80 check (min_consistency_percent between 0 and 100),
  tie_breaker text not null default 'consistency,evolution,volume,completed_days,user_id',
  rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (award_percent is not null or award_amount is not null)
);

create table if not exists public.prize_awards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  prize_type text not null check (prize_type in ('champion', 'second', 'third', 'evolution', 'consistency')),
  amount numeric(12,2) not null check (amount >= 0),
  awarded_at timestamptz not null default now(),
  unique (season_id, user_id, prize_type)
);

create index if not exists challenges_season_active_idx on public.challenges(season_id, is_active, starts_at, ends_at);
create index if not exists challenge_progress_user_idx on public.challenge_progress(user_id, challenge_id, status);
create index if not exists season_prizes_season_idx on public.season_prizes(season_id);
create index if not exists prize_awards_season_idx on public.prize_awards(season_id, prize_type, amount desc);

create or replace function public.validate_activity_type(p_activity_type text)
returns boolean language sql immutable as $$
  select trim(p_activity_type) in (
    'Caminhada leve', 'Caminhada rápida / inclinação', 'Musculação moderada',
    'Musculação pesada', 'Bike / spinning', 'Natação', 'Corrida',
    'Funcional / HIIT', 'Yoga / alongamento'
  );
$$;

create or replace function public.start_activity_session(p_activity_type text)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare
  current_season public.seasons;
  created_session public.activity_sessions;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.validate_activity_type(p_activity_type) then raise exception 'unsupported activity type'; end if;
  select * into current_season from public.seasons
  where status = 'active' and current_date between start_date and end_date
  order by start_date desc limit 1;
  if current_season.id is null then raise exception 'no active season'; end if;
  if not exists (select 1 from public.season_participants where season_id = current_season.id and user_id = auth.uid() and status = 'active') then raise exception 'active participation required'; end if;
  insert into public.activity_sessions (user_id, season_id, activity_type, started_at, status, source)
  values (auth.uid(), current_season.id, trim(p_activity_type), clock_timestamp(), 'active', 'move_checkin')
  returning * into created_session;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', created_session.id, 'started', jsonb_build_object('activity_type', created_session.activity_type));
  return created_session;
exception when unique_violation then
  raise exception 'an active activity session already exists';
end;
$$;

create or replace function public.pause_activity_session(p_session_id uuid)
returns public.activity_pauses language plpgsql security definer set search_path = public as $$
declare created_pause public.activity_pauses;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.activity_sessions where id = p_session_id and user_id = auth.uid() and status = 'active') then raise exception 'active session not found'; end if;
  insert into public.activity_pauses (activity_session_id, user_id, pause_started_at) values (p_session_id, auth.uid(), clock_timestamp()) returning * into created_pause;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action) values (auth.uid(), 'activity_session', p_session_id, 'paused');
  return created_pause;
exception when unique_violation then raise exception 'activity is already paused';
end;
$$;

create or replace function public.resume_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare resumed_session public.activity_sessions; pause_row public.activity_pauses;
begin
  select * into pause_row from public.activity_pauses where activity_session_id = p_session_id and user_id = auth.uid() and pause_ended_at is null;
  if pause_row.id is null then raise exception 'open pause not found'; end if;
  update public.activity_pauses set pause_ended_at = clock_timestamp() where id = pause_row.id;
  update public.activity_sessions set paused_seconds = paused_seconds + greatest(0, extract(epoch from (clock_timestamp() - pause_row.pause_started_at))::integer), updated_at = now() where id = p_session_id and user_id = auth.uid() and status = 'active' returning * into resumed_session;
  if resumed_session.id is null then raise exception 'active session not found'; end if;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action) values (auth.uid(), 'activity_session', p_session_id, 'resumed');
  return resumed_session;
end;
$$;

-- Keeps duration_seconds as the original elapsed column and adds an effective value
-- so existing clients remain compatible while scoring excludes every pause.
alter table public.activity_sessions add column if not exists effective_duration_seconds integer generated always as (
  case when ended_at is null then null else greatest(0, extract(epoch from (ended_at - started_at))::integer - paused_seconds) end
) stored;
alter table public.activity_sessions add column if not exists steps integer check (steps is null or steps >= 0);
alter table public.activity_sessions add column if not exists met_minutes numeric(12,2) generated always as (
  case when ended_at is null then null else round((case activity_type
    when 'Caminhada leve' then 3.5 when 'Caminhada rápida / inclinação' then 5
    when 'Musculação moderada' then 4 when 'Musculação pesada' then 6
    when 'Bike / spinning' then 7 when 'Natação' then 7 when 'Corrida' then 8
    when 'Funcional / HIIT' then 8 when 'Yoga / alongamento' then 2.5 else 0 end)
    * greatest(0, extract(epoch from (ended_at - started_at))::integer - paused_seconds) / 60.0, 2) end
) stored;

create or replace function public.finish_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare finished_session public.activity_sessions;
begin
  if not exists (select 1 from public.activity_sessions where id = p_session_id and user_id = auth.uid() and status = 'active') then raise exception 'active session not found'; end if;
  if exists (select 1 from public.activity_pauses where activity_session_id = p_session_id and pause_ended_at is null) then raise exception 'resume activity before finishing'; end if;
  if exists (select 1 from public.activity_sessions where id = p_session_id and (started_at > clock_timestamp() or extract(epoch from (clock_timestamp() - started_at)) > 86400)) then raise exception 'invalid activity duration'; end if;
  update public.activity_sessions set ended_at = clock_timestamp(), status = 'completed', updated_at = now()
  where id = p_session_id and user_id = auth.uid() and status = 'active'
  returning * into finished_session;
  if finished_session.id is null then raise exception 'active session not found'; end if;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', finished_session.id, 'finished', jsonb_build_object('effective_duration_seconds', finished_session.effective_duration_seconds));
  return finished_session;
end;
$$;

create or replace function public.edit_completed_activity_session(p_session_id uuid, p_activity_type text)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
begin
  raise exception 'completed activity is immutable';
end;
$$;

create or replace function public.join_challenge(p_challenge_id uuid)
returns public.challenge_progress language plpgsql security definer set search_path = public as $$
declare result public.challenge_progress; challenge_row public.challenges;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into challenge_row from public.challenges where id = p_challenge_id and is_active and now() between starts_at and ends_at;
  if challenge_row.id is null then raise exception 'challenge is not active'; end if;
  insert into public.challenge_progress (challenge_id, user_id, status)
  values (p_challenge_id, auth.uid(), 'joined')
  on conflict (challenge_id, user_id) do update set challenge_id = excluded.challenge_id
  returning * into result;
  return result;
end;
$$;

create or replace function public.submit_payment_proof(p_payment_id uuid, p_storage_path text)
returns public.payments language plpgsql security definer set search_path = public, storage as $$
declare target public.payments; stored_object storage.objects;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_storage_path), '') is null or split_part(p_storage_path, '/', 1) <> auth.uid()::text then raise exception 'invalid proof path'; end if;
  select * into target from public.payments where id = p_payment_id and user_id = auth.uid();
  if target.id is null then raise exception 'payment not found'; end if;
  if target.payment_status not in ('pending', 'rejected') then raise exception 'payment cannot receive a new proof'; end if;
  select * into stored_object from storage.objects where bucket_id = 'payment-proofs' and name = p_storage_path;
  if stored_object.id is null then raise exception 'proof file not found'; end if;
  if coalesce((stored_object.metadata ->> 'size')::bigint, 0) > 5242880 then raise exception 'proof file exceeds 5 MB'; end if;
  if lower(coalesce(stored_object.metadata ->> 'mimetype', '')) not in ('image/jpeg', 'image/png', 'application/pdf') then raise exception 'unsupported proof file type'; end if;
  update public.payments set proof_url = p_storage_path, payment_status = 'submitted', paid_at = now(), updated_at = now() where id = target.id returning * into target;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata) values (auth.uid(), 'payment', target.id, 'proof_submitted', jsonb_build_object('path', p_storage_path));
  return target;
end;
$$;

create or replace function public.apply_validated_challenge_progress(p_activity_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare activity public.activity_sessions; challenge_row public.challenges;
begin
  select * into activity from public.activity_sessions where id = p_activity_session_id and status = 'validated';
  if activity.id is null then raise exception 'validated activity not found'; end if;
  for challenge_row in select * from public.challenges where season_id = activity.season_id and is_active and activity.started_at between starts_at and ends_at loop
    insert into public.challenge_progress (challenge_id, user_id, progress, status)
    values (challenge_row.id, activity.user_id, least(challenge_row.objective, greatest(0, activity.effective_duration_seconds / 60.0)), 'in_progress')
    on conflict (challenge_id, user_id) do update set progress = least(challenge_row.objective, public.challenge_progress.progress + excluded.progress), status = case when least(challenge_row.objective, public.challenge_progress.progress + excluded.progress) >= challenge_row.objective then 'completed' else 'in_progress' end, completed_at = case when least(challenge_row.objective, public.challenge_progress.progress + excluded.progress) >= challenge_row.objective then coalesce(public.challenge_progress.completed_at, now()) else public.challenge_progress.completed_at end;
  end loop;
end;
$$;

create or replace function public.admin_upsert_season(
  p_season_id uuid, p_name text, p_description text, p_start_date date, p_end_date date,
  p_status public.season_status, p_entry_fee numeric, p_pix_key text, p_rules jsonb default '{}'::jsonb,
  p_prize_config jsonb default '{}'::jsonb
) returns public.seasons language plpgsql security definer set search_path = public as $$
declare result public.seasons;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_end_date <= p_start_date then raise exception 'end date must be after start date'; end if;
  if p_season_id is null then
    insert into public.seasons (name, description, start_date, end_date, status, entry_fee, pix_key, rules, prize_config)
    values (trim(p_name), p_description, p_start_date, p_end_date, p_status, greatest(0, p_entry_fee), nullif(trim(p_pix_key), ''), coalesce(p_rules, '{}'::jsonb), coalesce(p_prize_config, '{}'::jsonb)) returning * into result;
  else
    update public.seasons set name = trim(p_name), description = p_description, start_date = p_start_date, end_date = p_end_date, status = p_status, entry_fee = greatest(0, p_entry_fee), pix_key = nullif(trim(p_pix_key), ''), rules = coalesce(p_rules, '{}'::jsonb), prize_config = coalesce(p_prize_config, '{}'::jsonb), updated_at = now() where id = p_season_id returning * into result;
  end if;
  if result.id is null then raise exception 'season not found'; end if;
  return result;
end;
$$;

create or replace function public.admin_upsert_challenge(
  p_challenge_id uuid, p_season_id uuid, p_name text, p_description text, p_objective numeric,
  p_points integer, p_starts_at timestamptz, p_ends_at timestamptz, p_is_active boolean,
  p_badge_name text default null, p_badge_description text default null
) returns public.challenges language plpgsql security definer set search_path = public as $$
declare result public.challenges;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_ends_at <= p_starts_at or p_objective <= 0 or p_points < 0 then raise exception 'invalid challenge configuration'; end if;
  if p_challenge_id is null then
    insert into public.challenges (season_id, name, description, objective, points, starts_at, ends_at, is_active, badge_name, badge_description)
    values (p_season_id, trim(p_name), p_description, p_objective, p_points, p_starts_at, p_ends_at, p_is_active, p_badge_name, p_badge_description) returning * into result;
  else
    update public.challenges set season_id = p_season_id, name = trim(p_name), description = p_description, objective = p_objective, points = p_points, starts_at = p_starts_at, ends_at = p_ends_at, is_active = p_is_active, badge_name = p_badge_name, badge_description = p_badge_description, updated_at = now() where id = p_challenge_id returning * into result;
  end if;
  if result.id is null then raise exception 'challenge not found'; end if;
  return result;
end;
$$;

create or replace function public.admin_upsert_season_prize(
  p_season_id uuid, p_award_percent numeric, p_award_amount numeric, p_champion_amount numeric,
  p_second_amount numeric, p_third_amount numeric, p_evolution_amount numeric, p_consistency_amount numeric,
  p_min_consistency_percent numeric default 80, p_tie_breaker text default 'consistency,evolution,volume,completed_days,user_id', p_rules jsonb default '{}'::jsonb
) returns public.season_prizes language plpgsql security definer set search_path = public as $$
declare result public.season_prizes;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_award_percent is null and p_award_amount is null then raise exception 'award percent or amount is required'; end if;
  insert into public.season_prizes (season_id, award_percent, award_amount, champion_amount, second_amount, third_amount, evolution_amount, consistency_amount, min_consistency_percent, tie_breaker, rules)
  values (p_season_id, p_award_percent, p_award_amount, p_champion_amount, p_second_amount, p_third_amount, p_evolution_amount, p_consistency_amount, p_min_consistency_percent, p_tie_breaker, coalesce(p_rules, '{}'::jsonb))
  on conflict (season_id) do update set award_percent = excluded.award_percent, award_amount = excluded.award_amount, champion_amount = excluded.champion_amount, second_amount = excluded.second_amount, third_amount = excluded.third_amount, evolution_amount = excluded.evolution_amount, consistency_amount = excluded.consistency_amount, min_consistency_percent = excluded.min_consistency_percent, tie_breaker = excluded.tie_breaker, rules = excluded.rules, updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.admin_set_profile_status(p_user_id uuid, p_status public.profile_status)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare result public.profiles;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_user_id = auth.uid() then raise exception 'administrator cannot change own status'; end if;
  update public.profiles set status = p_status, updated_at = now() where id = p_user_id returning * into result;
  if result.id is null then raise exception 'profile not found'; end if;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata) values (auth.uid(), 'profile', p_user_id, 'status_changed', jsonb_build_object('status', p_status));
  return result;
end;
$$;

create or replace function public.prevent_participant_protected_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and (old.id is distinct from new.id or old.email is distinct from new.email or old.created_at is distinct from new.created_at or old.role is distinct from new.role or old.status is distinct from new.status) then
    raise exception 'protected profile fields cannot be changed by the participant';
  end if;
  return new;
end;
$$;

-- Replace only the scoring function. It remains idempotent through the unique contribution.
create or replace function public.apply_validated_activity_score(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare activity public.activity_sessions; season public.seasons; baseline public.baseline_metrics; week_number integer; week_start date; consistency integer; evolution integer; volume integer; completed_days integer; contribution_id uuid;
begin
  select * into activity from public.activity_sessions where id = p_session_id and status = 'validated';
  if activity.id is null then raise exception 'validated activity not found'; end if;
  select * into season from public.seasons where id = activity.season_id;
  week_number := greatest(1, least(8, floor((activity.started_at::date - season.start_date)::numeric / 7)::integer + 1));
  week_start := season.start_date + ((week_number - 1) * 7);
  if activity.started_at::date < week_start or activity.started_at::date > week_start + 5 then return; end if;
  select * into baseline from public.baseline_metrics where season_id = activity.season_id and user_id = activity.user_id;
  consistency := case when coalesce(activity.effective_duration_seconds, 0) >= 1800 or coalesce(activity.steps, 0) >= 8000 then 10 else 0 end;
  evolution := case when baseline.frozen_at is not null and baseline.average_active_minutes > 0 then least(25, greatest(0, floor((((activity.effective_duration_seconds / 60.0) / baseline.average_active_minutes - 1) * 100) / 2)::integer)) else 0 end;
  volume := least(20, floor(coalesce(activity.met_minutes, 0) / 40)::integer);
  insert into public.activity_score_contributions (activity_session_id, user_id, season_id, score_date, consistency_points, evolution_points, volume_points) values (activity.id, activity.user_id, activity.season_id, activity.started_at::date, consistency, evolution, volume) on conflict (activity_session_id) do nothing returning id into contribution_id;
  if contribution_id is null then return; end if;
  select count(distinct score_date) into completed_days
  from public.activity_score_contributions
  where user_id = activity.user_id and season_id = activity.season_id
    and score_date between week_start and week_start + 5
    and consistency_points >= 10;
  insert into public.daily_scores (user_id, season_id, score_date, consistency_points, evolution_points, volume_points)
  select activity.user_id, activity.season_id, score_date,
    case when max(consistency_points) >= 10 then 10 else 0 end,
    least(25, sum(evolution_points)), least(20, sum(volume_points))
  from public.activity_score_contributions
  where user_id = activity.user_id and season_id = activity.season_id
    and score_date = activity.started_at::date
  group by score_date
  on conflict (user_id, season_id, score_date) do update set
    consistency_points = excluded.consistency_points,
    evolution_points = excluded.evolution_points,
    volume_points = excluded.volume_points,
    calculated_at = now();
  insert into public.weekly_scores (user_id, season_id, week_number, consistency_points, evolution_points, volume_points, bonus_points, completed_days)
  select activity.user_id, activity.season_id, week_number,
    least(60, completed_days * 10),
    least(25, coalesce(sum(evolution_points), 0)),
    least(20, coalesce(sum(volume_points), 0)),
    case when completed_days >= 5 then 15 else 0 end,
    least(6, completed_days)
  from public.activity_score_contributions
  where user_id = activity.user_id and season_id = activity.season_id
    and score_date between week_start and week_start + 5
  on conflict (user_id, season_id, week_number) do update set
    consistency_points = excluded.consistency_points,
    evolution_points = excluded.evolution_points,
    volume_points = excluded.volume_points,
    bonus_points = excluded.bonus_points,
    completed_days = excluded.completed_days,
    updated_at = now();
  perform public.apply_validated_challenge_progress(activity.id);
end;
$$;

alter table public.challenges enable row level security;
alter table public.challenge_progress enable row level security;
alter table public.season_prizes enable row level security;
alter table public.prize_awards enable row level security;
alter table public.activity_pauses enable row level security;

drop policy if exists "participants submit own pix payment" on public.payments;
create policy "participants submit own pix payment" on public.payments for update to authenticated using (false) with check (false);
drop policy if exists "participants upload own payment proof" on storage.objects;
create policy "participants upload own payment proof" on storage.objects for insert to authenticated with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'pdf') and coalesce((metadata ->> 'size')::bigint, 0) <= 5242880);
drop policy if exists "participants view own pauses" on public.activity_pauses;
create policy "participants view own pauses" on public.activity_pauses for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admins manage pauses" on public.activity_pauses;
create policy "admins manage pauses" on public.activity_pauses for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$ begin
  create policy "authenticated users view active challenges" on public.challenges for select to authenticated using ((is_active and now() between starts_at and ends_at) or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "participants view own challenge progress" on public.challenge_progress for select to authenticated using (user_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage challenge progress" on public.challenge_progress for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated users view season prizes" on public.season_prizes for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage season prizes" on public.season_prizes for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated users view prize awards" on public.prize_awards for select to authenticated using (user_id = auth.uid() or public.is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "admins manage prize awards" on public.prize_awards for all to authenticated using (public.is_admin()) with check (public.is_admin());
exception when duplicate_object then null; end $$;

revoke all on function public.validate_activity_type(text) from public;
revoke all on function public.pause_activity_session(uuid) from public;
revoke all on function public.resume_activity_session(uuid) from public;
revoke all on function public.submit_payment_proof(uuid, text) from public;
revoke all on function public.prevent_participant_protected_profile_changes() from public;
grant execute on function public.pause_activity_session(uuid) to authenticated;
grant execute on function public.resume_activity_session(uuid) to authenticated;
grant execute on function public.submit_payment_proof(uuid, text) to authenticated;
revoke all on function public.edit_completed_activity_session(uuid, text) from authenticated;
revoke all on function public.join_challenge(uuid) from public;
revoke all on function public.apply_validated_challenge_progress(uuid) from public;
revoke all on function public.admin_upsert_season(uuid, text, text, date, date, public.season_status, numeric, text, jsonb, jsonb) from public;
revoke all on function public.admin_upsert_challenge(uuid, uuid, text, text, numeric, integer, timestamptz, timestamptz, boolean, text, text) from public;
revoke all on function public.admin_upsert_season_prize(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, jsonb) from public;
revoke all on function public.admin_set_profile_status(uuid, public.profile_status) from public;
grant execute on function public.join_challenge(uuid) to authenticated;
grant execute on function public.admin_upsert_season(uuid, text, text, date, date, public.season_status, numeric, text, jsonb, jsonb) to authenticated;
grant execute on function public.admin_upsert_challenge(uuid, uuid, text, text, numeric, integer, timestamptz, timestamptz, boolean, text, text) to authenticated;
grant execute on function public.admin_upsert_season_prize(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, jsonb) to authenticated;
grant execute on function public.admin_set_profile_status(uuid, public.profile_status) to authenticated;

do $$ begin
  create trigger challenges_set_updated_at before update on public.challenges for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
