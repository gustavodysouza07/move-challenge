create extension if not exists pgcrypto;

create type public.user_role as enum ('participant', 'admin');
create type public.profile_status as enum ('pending', 'active', 'blocked');
create type public.season_status as enum ('draft', 'registration', 'active', 'finished', 'cancelled');
create type public.season_participant_status as enum ('pending_payment', 'pending_approval', 'active', 'eliminated', 'withdrawn');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null,
  phone text,
  avatar_url text,
  role public.user_role not null default 'participant',
  status public.profile_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text,
  start_date date not null,
  end_date date not null,
  status public.season_status not null default 'draft',
  entry_fee numeric(12,2) not null default 0 check (entry_fee >= 0),
  max_participants integer check (max_participants is null or max_participants > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date > start_date)
);

create table public.season_participants (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.season_participant_status not null default 'pending_payment',
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (season_id, user_id)
);

create table public.baseline_metrics (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  average_steps numeric(12,2) not null default 0 check (average_steps >= 0),
  average_active_minutes numeric(12,2) not null default 0 check (average_active_minutes >= 0),
  baseline_period_start date not null,
  baseline_period_end date not null,
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, user_id),
  check (baseline_period_end >= baseline_period_start)
);

-- Kept for the next scoring step. Clients can read scores but never write them.
create table public.daily_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  score_date date not null,
  consistency_points integer not null default 0 check (consistency_points >= 0),
  evolution_points integer not null default 0 check (evolution_points >= 0),
  volume_points integer not null default 0 check (volume_points >= 0),
  total_points integer generated always as (consistency_points + evolution_points + volume_points) stored,
  calculated_at timestamptz not null default now(),
  unique (user_id, season_id, score_date)
);

create table if not exists public.weekly_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  week_number integer not null check (week_number between 1 and 8),
  consistency_points integer not null default 0 check (consistency_points >= 0),
  evolution_points integer not null default 0 check (evolution_points >= 0),
  volume_points integer not null default 0 check (volume_points >= 0),
  bonus_points integer not null default 0 check (bonus_points >= 0),
  completed_days integer not null default 0 check (completed_days between 0 and 6),
  total_points integer generated always as (least(120, consistency_points + evolution_points + volume_points + bonus_points)) stored,
  updated_at timestamptz not null default now(),
  unique (user_id, season_id, week_number)
);
alter table public.weekly_scores add column if not exists completed_days integer not null default 0 check (completed_days between 0 and 6);

do $$ begin
  create type public.activity_session_status as enum ('active', 'completed', 'cancelled', 'pending_validation', 'validated', 'rejected');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.activity_session_source as enum ('move_checkin', 'manual', 'integration');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.payment_method as enum ('pix');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.payment_gateway as enum ('manual');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.payment_status as enum ('pending', 'submitted', 'confirmed', 'rejected', 'refunded');
exception when duplicate_object then null;
end $$;

create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  activity_type text not null check (char_length(activity_type) between 2 and 80),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer generated always as (case when ended_at is null then null else greatest(0, extract(epoch from (ended_at - started_at))::integer) end) stored,
  status public.activity_session_status not null default 'active',
  source public.activity_session_source not null default 'move_checkin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (started_at <= now()),
  check (ended_at is null or ended_at >= started_at),
  check ((status = 'active' and ended_at is null) or (status <> 'active' and ended_at is not null))
);

create unique index if not exists activity_sessions_one_active_idx on public.activity_sessions(user_id) where status = 'active';
create index if not exists activity_sessions_validation_idx on public.activity_sessions(status, created_at);

create table if not exists public.activity_proofs (
  id uuid primary key default gen_random_uuid(),
  activity_session_id uuid not null references public.activity_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  proof_type text not null default 'move_checkin',
  storage_path text,
  external_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  payment_method public.payment_method not null default 'pix',
  payment_status public.payment_status not null default 'pending',
  proof_url text,
  paid_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  transaction_id text,
  gateway public.payment_gateway not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, season_id)
);

create table if not exists public.wildcards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  used_on date,
  created_at timestamptz not null default now(),
  unique (season_id, user_id, used_on)
);
create index if not exists wildcards_user_season_idx on public.wildcards(user_id, season_id);

create or replace function public.start_activity_session(p_activity_type text)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare
  current_season public.seasons;
  created_session public.activity_sessions;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into current_season from public.seasons where status = 'active' and current_date between start_date and end_date order by start_date desc limit 1;
  if current_season.id is null then raise exception 'no active season'; end if;
  if not exists (select 1 from public.season_participants where season_id = current_season.id and user_id = auth.uid() and status = 'active') then raise exception 'active participation required'; end if;
  insert into public.activity_sessions (user_id, season_id, activity_type, started_at, status, source)
  values (auth.uid(), current_season.id, p_activity_type, clock_timestamp(), 'active', 'move_checkin')
  returning * into created_session;
  return created_session;
exception when unique_violation then
  raise exception 'an active activity session already exists';
end;
$$;

create or replace function public.finish_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare finished_session public.activity_sessions;
begin
  update public.activity_sessions set ended_at = clock_timestamp(), status = 'completed', updated_at = now()
  where id = p_session_id and user_id = auth.uid() and status = 'active'
  returning * into finished_session;
  if finished_session.id is null then raise exception 'active session not found'; end if;
  return finished_session;
end;
$$;

create or replace function public.submit_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare submitted_session public.activity_sessions;
begin
  update public.activity_sessions set status = 'pending_validation', updated_at = now()
  where id = p_session_id and user_id = auth.uid() and status = 'completed'
  returning * into submitted_session;
  if submitted_session.id is null then raise exception 'completed session not found'; end if;
  insert into public.activity_proofs (activity_session_id, user_id, proof_type)
  values (submitted_session.id, auth.uid(), 'move_checkin');
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', submitted_session.id, 'submitted_for_validation', jsonb_build_object('source', 'move_checkin'));
  return submitted_session;
end;
$$;

create or replace function public.edit_completed_activity_session(p_session_id uuid, p_activity_type text)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare edited_session public.activity_sessions;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_activity_type), '') is null then raise exception 'activity type is required'; end if;
  update public.activity_sessions set activity_type = p_activity_type, updated_at = now()
  where id = p_session_id and user_id = auth.uid() and status = 'completed'
  returning * into edited_session;
  if edited_session.id is null then raise exception 'completed session not editable'; end if;
  return edited_session;
end;
$$;

create or replace function public.request_season_participation(p_season_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target_season public.seasons; target_payment public.payments;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into target_season from public.seasons where id = p_season_id and status = 'registration';
  if target_season.id is null then raise exception 'season is not accepting registrations'; end if;
  insert into public.season_participants (season_id, user_id, status) values (target_season.id, auth.uid(), 'pending_payment') on conflict (season_id, user_id) do nothing;
  insert into public.payments (season_id, user_id, amount, payment_method, payment_status, gateway)
  values (target_season.id, auth.uid(), target_season.entry_fee, 'pix', 'pending', 'manual')
  on conflict (user_id, season_id) do update set amount = excluded.amount
  returning * into target_payment;
  return target_payment;
end;
$$;

create or replace function public.admin_validate_activity(p_session_id uuid, p_approved boolean, p_rejection_reason text default null)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare target public.activity_sessions; next_status public.activity_session_status;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_approved then next_status := 'validated'; else next_status := 'rejected'; end if;
  if not p_approved and nullif(trim(p_rejection_reason), '') is null then raise exception 'rejection reason is required'; end if;
  update public.activity_sessions set status = next_status, updated_at = now() where id = p_session_id and status = 'pending_validation' returning * into target;
  if target.id is null then raise exception 'activity pending validation not found'; end if;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', target.id, case when p_approved then 'validated' else 'rejected' end, jsonb_build_object('reason', p_rejection_reason));
  if p_approved then perform public.apply_validated_activity_score(target.id); end if;
  return target;
end;
$$;

create or replace function public.apply_validated_activity_score(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  activity public.activity_sessions;
  season public.seasons;
  baseline public.baseline_metrics;
  week_number integer;
  week_start date;
  met_value numeric;
  consistency integer;
  evolution integer;
  volume integer;
  completed_days integer;
begin
  select * into activity from public.activity_sessions where id = p_session_id and status = 'validated';
  if activity.id is null then raise exception 'validated activity not found'; end if;
  select * into season from public.seasons where id = activity.season_id;
  week_number := greatest(1, least(8, floor((activity.started_at::date - season.start_date)::numeric / 7)::integer + 1));
  week_start := season.start_date + ((week_number - 1) * 7);
  if activity.started_at::date < week_start or activity.started_at::date > week_start + 5 then return; end if;
  select * into baseline from public.baseline_metrics where season_id = activity.season_id and user_id = activity.user_id;
  met_value := case activity.activity_type
    when 'Caminhada leve' then 3.5 when 'Caminhada rápida / inclinação' then 5 when 'Musculação moderada' then 4
    when 'Musculação pesada' then 6 when 'Bike / spinning' then 7 when 'Natação' then 7 when 'Corrida' then 8
    when 'Funcional / HIIT' then 8 when 'Yoga / alongamento' then 2.5 else 1 end;
  consistency := case when coalesce(activity.duration_seconds, 0) >= 1800 then 10 else 0 end;
  evolution := case when baseline.frozen_at is not null and baseline.average_active_minutes > 0 then least(25, greatest(0, floor((((activity.duration_seconds / 60.0) / baseline.average_active_minutes - 1) * 100) / 2)::integer)) else 0 end;
  volume := least(20, floor((met_value * coalesce(activity.duration_seconds, 0) / 60) / 40)::integer);
  insert into public.daily_scores (user_id, season_id, score_date, consistency_points, evolution_points, volume_points)
  values (activity.user_id, activity.season_id, activity.started_at::date, consistency, evolution, volume)
  on conflict (user_id, season_id, score_date) do update set consistency_points = greatest(daily_scores.consistency_points, excluded.consistency_points), evolution_points = greatest(daily_scores.evolution_points, excluded.evolution_points), volume_points = least(20, daily_scores.volume_points + excluded.volume_points), calculated_at = now();
  select count(*) into completed_days from public.daily_scores where user_id = activity.user_id and season_id = activity.season_id and score_date between week_start and week_start + 5 and consistency_points >= 10;
  insert into public.weekly_scores (user_id, season_id, week_number, consistency_points, evolution_points, volume_points, bonus_points, completed_days)
  select activity.user_id, activity.season_id, week_number, least(60, coalesce(sum(consistency_points), 0)), least(25, coalesce(sum(evolution_points), 0)), least(20, coalesce(sum(volume_points), 0)), case when completed_days >= 5 then 15 else 0 end, least(6, completed_days)
  from public.daily_scores where user_id = activity.user_id and season_id = activity.season_id and score_date between week_start and week_start + 5
  on conflict (user_id, season_id, week_number) do update set consistency_points = excluded.consistency_points, evolution_points = excluded.evolution_points, volume_points = excluded.volume_points, bonus_points = excluded.bonus_points, completed_days = excluded.completed_days, updated_at = now();
end;
$$;

create or replace function public.confirm_payment(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target public.payments;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  update public.payments set payment_status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid(), updated_at = now() where id = p_payment_id and payment_status in ('pending', 'submitted') returning * into target;
  if target.id is null then raise exception 'payment pending confirmation not found'; end if;
  update public.season_participants set status = 'active', approved_at = now() where season_id = target.season_id and user_id = target.user_id and status in ('pending_payment', 'pending_approval');
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'payment', target.id, 'confirmed', jsonb_build_object('season_id', target.season_id, 'user_id', target.user_id));
  return target;
end;
$$;

create or replace function public.reject_payment(p_payment_id uuid, p_reason text)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target public.payments;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'rejection reason is required'; end if;
  update public.payments set payment_status = 'rejected', confirmed_at = null, confirmed_by = auth.uid(), updated_at = now() where id = p_payment_id and payment_status in ('pending', 'submitted') returning * into target;
  if target.id is null then raise exception 'payment pending rejection not found'; end if;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'payment', target.id, 'rejected', jsonb_build_object('reason', p_reason, 'season_id', target.season_id, 'user_id', target.user_id));
  return target;
end;
$$;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger seasons_set_updated_at before update on public.seasons for each row execute function public.set_updated_at();
create trigger baseline_set_updated_at before update on public.baseline_metrics for each row execute function public.set_updated_at();
create trigger activity_sessions_set_updated_at before update on public.activity_sessions for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();

create or replace function public.prevent_participant_protected_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and old.role <> new.role then
    raise exception 'role cannot be changed by the participant';
  end if;
  if auth.uid() = old.id and old.status <> new.status then
    raise exception 'status cannot be changed by the participant';
  end if;
  return new;
end;
$$;

create trigger profiles_protected_fields before update on public.profiles
for each row execute function public.prevent_participant_protected_profile_changes();

create or replace function public.prevent_frozen_baseline_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.frozen_at is not null and (new.average_steps is distinct from old.average_steps or new.average_active_minutes is distinct from old.average_active_minutes or new.baseline_period_start is distinct from old.baseline_period_start or new.baseline_period_end is distinct from old.baseline_period_end) then
    raise exception 'frozen baseline cannot be changed';
  end if;
  if auth.uid() = old.user_id and new.frozen_at is distinct from old.frozen_at then
    raise exception 'baseline freeze state is server controlled';
  end if;
  return new;
end;
$$;

create trigger baseline_frozen_guard before update on public.baseline_metrics
for each row execute function public.prevent_frozen_baseline_changes();

create or replace function public.prevent_participant_payment_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.user_id and (new.user_id is distinct from old.user_id or new.season_id is distinct from old.season_id or new.amount is distinct from old.amount or new.payment_method is distinct from old.payment_method or new.gateway is distinct from old.gateway or new.payment_status in ('confirmed', 'rejected', 'refunded') or new.confirmed_by is distinct from old.confirmed_by or new.confirmed_at is distinct from old.confirmed_at) then
    raise exception 'protected payment fields cannot be changed by the participant';
  end if;
  return new;
end;
$$;

create trigger payments_protected_fields before update on public.payments
for each row execute function public.prevent_participant_payment_changes();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  generated_name text;
begin
  generated_name := coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, full_name, email, phone, status)
  values (new.id, generated_name, new.email, nullif(new.raw_user_meta_data ->> 'phone', ''), 'pending');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.season_participants enable row level security;
alter table public.baseline_metrics enable row level security;
alter table public.daily_scores enable row level security;
alter table public.weekly_scores enable row level security;
alter table public.audit_logs enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.activity_proofs enable row level security;
alter table public.payments enable row level security;
alter table public.wildcards enable row level security;

create policy "authenticated users view active profiles" on public.profiles for select to authenticated using (status <> 'blocked' or id = auth.uid() or public.is_admin());
create policy "participants edit allowed profile fields" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "admins manage profiles" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "authenticated users view seasons" on public.seasons for select to authenticated using (true);
create policy "admins manage seasons" on public.seasons for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "participants view own season participation" on public.season_participants for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "participants request season participation" on public.season_participants for insert to authenticated with check (false);
create policy "admins manage season participation" on public.season_participants for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "participants view own baseline" on public.baseline_metrics for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "participants create own baseline" on public.baseline_metrics for insert to authenticated with check (user_id = auth.uid() and frozen_at is null);
create policy "participants update own unfrozen baseline" on public.baseline_metrics for update to authenticated using (user_id = auth.uid() and frozen_at is null) with check (user_id = auth.uid() and frozen_at is null);
create policy "admins manage baselines" on public.baseline_metrics for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "authenticated users view scores" on public.daily_scores for select to authenticated using (true);
create policy "admins manage scores" on public.daily_scores for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "authenticated users view weekly scores" on public.weekly_scores for select to authenticated using (true);
create policy "admins manage weekly scores" on public.weekly_scores for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "participants view own activity sessions" on public.activity_sessions for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "participants start own activity sessions" on public.activity_sessions for insert to authenticated with check (false);
create policy "participants cannot update activity sessions" on public.activity_sessions for update to authenticated using (false) with check (false);
create policy "admins manage activity sessions" on public.activity_sessions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "participants view own activity proofs" on public.activity_proofs for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "participants add own activity proofs" on public.activity_proofs for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from public.activity_sessions where id = activity_session_id and user_id = auth.uid()));
create policy "admins manage activity proofs" on public.activity_proofs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "participants view own payments" on public.payments for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "participants create own payments" on public.payments for insert to authenticated with check (false);
create policy "participants submit own pix payment" on public.payments for update to authenticated using (user_id = auth.uid() and payment_status in ('pending', 'submitted')) with check (user_id = auth.uid() and payment_status in ('pending', 'submitted') and amount = (select entry_fee from public.seasons where id = season_id));
create policy "admins manage payments" on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "participants view own wildcards" on public.wildcards for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "admins manage wildcards" on public.wildcards for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins view audit logs" on public.audit_logs for select to authenticated using (public.is_admin() or actor_id = auth.uid());
create policy "service writes audit logs" on public.audit_logs for insert to authenticated with check (actor_id = auth.uid() or public.is_admin());

create index profiles_role_status_idx on public.profiles(role, status);
create index seasons_status_dates_idx on public.seasons(status, start_date, end_date);
create index season_participants_season_status_idx on public.season_participants(season_id, status);
create index season_participants_user_idx on public.season_participants(user_id);
create index baseline_metrics_user_season_idx on public.baseline_metrics(user_id, season_id);
create index daily_scores_season_points_idx on public.daily_scores(season_id, total_points desc);
create index weekly_scores_season_points_idx on public.weekly_scores(season_id, total_points desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

-- Create this bucket once in Supabase Storage for manual PIX receipts.
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;
create policy "participants upload own payment proof" on storage.objects for insert to authenticated with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "participants view own payment proof" on storage.objects for select to authenticated using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admins view payment proofs" on storage.objects for select to authenticated using (bucket_id = 'payment-proofs' and public.is_admin());

-- The definitive scoring, payment validation and activity validation must be implemented
-- in privileged RPCs or Edge Functions before production. Never trust client totals.
