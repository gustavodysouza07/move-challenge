create extension if not exists pgcrypto;

create type public.activity_kind as enum ('Caminhada leve', 'Caminhada rápida / inclinação', 'Musculação moderada', 'Musculação pesada', 'Bike / spinning', 'Natação', 'Corrida', 'Funcional / HIIT', 'Yoga / alongamento');
create type public.challenge_kind as enum ('weekly_battle', 'flash', 'duel');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  handle text unique not null check (handle ~ '^[a-z0-9_]+$'),
  avatar_emoji text not null default '🪩',
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.seasons (
  id uuid primary key default gen_random_uuid(), name text not null, starts_at date not null,
  ends_at date not null, onboarding_ends_at date not null, status text not null default 'draft',
  created_at timestamptz not null default now(), check (ends_at > starts_at)
);
create table public.season_participants (
  season_id uuid references public.seasons(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade,
  baseline_met_min numeric not null default 0 check (baseline_met_min >= 0), baseline_frozen_at timestamptz,
  total_points integer not null default 0 check (total_points >= 0), current_streak integer not null default 0,
  primary key (season_id, user_id)
);
create table public.activities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade, activity_date date not null,
  kind public.activity_kind not null, minutes integer not null check (minutes > 0 and minutes <= 1440),
  steps integer not null default 0 check (steps >= 0 and steps <= 200000), met_value numeric not null check (met_value > 0),
  recorded_at timestamptz not null default now(), edited_at timestamptz, unique (user_id, season_id, activity_date, kind)
);
create table public.daily_scores (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.seasons(id) on delete cascade, score_date date not null,
  consistency_points integer not null default 0, evolution_points integer not null default 0, volume_points integer not null default 0,
  wildcard_used boolean not null default false, total_points integer generated always as (consistency_points + evolution_points + volume_points) stored,
  calculated_at timestamptz not null default now(), unique (user_id, season_id, score_date)
);
create table public.achievements (id uuid primary key default gen_random_uuid(), slug text unique not null, name text not null, description text not null, icon text not null);
create table public.user_achievements (user_id uuid references public.profiles(id) on delete cascade, achievement_id uuid references public.achievements(id) on delete cascade, earned_at timestamptz not null default now(), primary key (user_id, achievement_id));
create table public.challenges (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons(id) on delete cascade, kind public.challenge_kind not null, title text not null, description text not null, starts_at timestamptz not null, ends_at timestamptz not null, reward_points integer not null default 0);
create table public.challenge_progress (challenge_id uuid references public.challenges(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, progress numeric not null default 0, completed_at timestamptz, primary key (challenge_id, user_id));
create table public.duels (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons(id) on delete cascade, created_by uuid references public.profiles(id), status text not null default 'pending', ends_at timestamptz not null);
create table public.duel_participants (duel_id uuid references public.duels(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, points integer not null default 0, primary key (duel_id, user_id));
create table public.wildcards (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade, used_on date, created_at timestamptz not null default now());
create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references auth.users(id), entity_type text not null, entity_id uuid, action text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

alter table public.profiles enable row level security;
alter table public.season_participants enable row level security;
alter table public.activities enable row level security;
alter table public.daily_scores enable row level security;
alter table public.user_achievements enable row level security;
alter table public.challenge_progress enable row level security;
alter table public.duel_participants enable row level security;
alter table public.wildcards enable row level security;
alter table public.audit_logs enable row level security;
alter table public.seasons enable row level security;
alter table public.achievements enable row level security;
alter table public.challenges enable row level security;
alter table public.duels enable row level security;

create policy "profiles are visible to authenticated users" on public.profiles for select to authenticated using (true);
create policy "users edit own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "participants are visible" on public.season_participants for select to authenticated using (true);
create policy "own activities are visible" on public.activities for select to authenticated using (auth.uid() = user_id);
create policy "users add own activities" on public.activities for insert to authenticated with check (auth.uid() = user_id and activity_date <= current_date);
create policy "scores are visible" on public.daily_scores for select to authenticated using (true);
create policy "achievements are visible" on public.achievements for select to authenticated using (true);
create policy "earned badges are visible" on public.user_achievements for select to authenticated using (true);
create policy "challenges are visible" on public.challenges for select to authenticated using (true);
create policy "challenge progress is visible" on public.challenge_progress for select to authenticated using (true);
create policy "duels are visible" on public.duels for select to authenticated using (true);
create policy "duel participants are visible" on public.duel_participants for select to authenticated using (true);
create policy "own wildcards are visible" on public.wildcards for select to authenticated using (auth.uid() = user_id);
create policy "own audit logs are visible" on public.audit_logs for select to authenticated using (auth.uid() = actor_id);

create index activities_user_date_idx on public.activities(user_id, activity_date);
create index daily_scores_season_points_idx on public.daily_scores(season_id, total_points desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

-- Scoring must be moved to a privileged RPC or Edge Function before production.
-- That function should validate the frozen baseline, server timestamp, edit window,
-- duplicate activity constraint, weekly caps and write an audit_logs entry atomically.
