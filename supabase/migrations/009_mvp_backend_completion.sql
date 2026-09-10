-- 009_mvp_backend_completion.sql
-- Fecha o backend do MVP:
--   a) completa os objetos da 002 que nunca chegaram ao banco;
--   b) implementa a meta por passos (30 min OU 8.000 passos);
--   c) corrige dois erros de contagem na pontuação;
--   d) limita o tamanho do emoji de avatar.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ------------------------------------------- 1. Colunas ausentes da 002
alter table public.seasons add column if not exists pix_key text;
alter table public.seasons add column if not exists rules jsonb not null default '{}'::jsonb;
alter table public.seasons add column if not exists prize_config jsonb not null default '{}'::jsonb;

alter table public.activity_sessions add column if not exists steps integer;
alter table public.activity_sessions drop constraint if exists activity_sessions_steps_check;
alter table public.activity_sessions add constraint activity_sessions_steps_check
  check (steps is null or (steps >= 0 and steps <= 200000));

-- O participante edita o próprio perfil direto na tabela, sem RPC.
-- Sem esta restrição, dá para salvar um texto inteiro no lugar do emoji.
alter table public.profiles drop constraint if exists profiles_avatar_emoji_check;
alter table public.profiles add constraint profiles_avatar_emoji_check
  check (avatar_emoji is null or char_length(avatar_emoji) between 1 and 16);

-- --------------------------------- 2. Envio da atividade agora leva passos
drop function if exists public.submit_activity_session_with_proof(uuid, text);
drop function if exists public.submit_activity_session_with_proof(uuid, text, integer);

create function public.submit_activity_session_with_proof(
  p_session_id uuid,
  p_storage_path text,
  p_steps integer default null
)
returns public.activity_sessions language plpgsql security definer set search_path = public, storage as $$
declare target public.activity_sessions; stored_object storage.objects;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_storage_path), '') is null
     or split_part(p_storage_path, '/', 1) <> auth.uid()::text
  then raise exception 'invalid proof path'; end if;
  if p_steps is not null and (p_steps < 0 or p_steps > 200000) then
    raise exception 'invalid steps value';
  end if;

  select * into target from public.activity_sessions
   where id = p_session_id and user_id = auth.uid() and status = 'completed';
  if target.id is null then raise exception 'completed activity not found'; end if;

  select * into stored_object from storage.objects
   where bucket_id = 'activity-proofs' and name = p_storage_path;
  if stored_object.id is null then raise exception 'proof file not found'; end if;

  if coalesce((stored_object.metadata ->> 'size')::bigint, 0) > 5242880 then
    raise exception 'proof file exceeds 5 MB';
  end if;
  if lower(coalesce(stored_object.metadata ->> 'mimetype', '')) not in
     ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
    raise exception 'unsupported proof file type';
  end if;

  insert into public.activity_proofs (activity_session_id, user_id, proof_type, storage_path)
  values (target.id, auth.uid(), 'activity_checkin', p_storage_path);

  update public.activity_sessions
     set steps = p_steps, status = 'pending_validation', updated_at = now()
   where id = target.id returning * into target;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', target.id, 'submitted_for_validation',
          jsonb_build_object('path', p_storage_path, 'steps', p_steps));

  return target;
exception when unique_violation then
  raise exception 'activity proof already submitted';
end;
$$;

-- ------------------------------------------------ 3. Pontuação corrigida
-- a) meta diária passa a aceitar 30 min OU 8.000 passos;
-- b) teto de consistência por DIA é 10 (o 60 é semanal);
-- c) dias concluídos contam datas distintas — antes, duas atividades no
--    mesmo dia contavam como dois dias e disparavam o bônus de +15.
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
  contribution_id uuid;
begin
  select * into activity from public.activity_sessions
   where id = p_session_id and status = 'validated';
  if activity.id is null then raise exception 'validated activity not found'; end if;

  select * into season from public.seasons where id = activity.season_id;

  week_number := greatest(1, least(8,
    floor((activity.started_at::date - season.start_date)::numeric / 7)::integer + 1));
  week_start := season.start_date + ((week_number - 1) * 7);

  if activity.started_at::date < week_start or activity.started_at::date > week_start + 5 then
    return;
  end if;

  select * into baseline from public.baseline_metrics
   where season_id = activity.season_id and user_id = activity.user_id;

  met_value := case activity.activity_type
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

  consistency := case
    when coalesce(activity.duration_seconds, 0) >= 1800
      or coalesce(activity.steps, 0) >= 8000
    then 10 else 0 end;

  evolution := case
    when baseline.frozen_at is not null and baseline.average_active_minutes > 0
    then least(25, greatest(0, floor(
      (((activity.duration_seconds / 60.0) / baseline.average_active_minutes - 1) * 100) / 2
    )::integer))
    else 0 end;

  volume := least(20, floor((met_value * coalesce(activity.duration_seconds, 0) / 60) / 40)::integer);

  insert into public.activity_score_contributions
    (activity_session_id, user_id, season_id, score_date,
     consistency_points, evolution_points, volume_points)
  values
    (activity.id, activity.user_id, activity.season_id, activity.started_at::date,
     consistency, evolution, volume)
  on conflict (activity_session_id) do nothing
  returning id into contribution_id;

  if contribution_id is null then return; end if;

  select count(distinct score_date) into completed_days
    from public.activity_score_contributions
   where user_id = activity.user_id
     and season_id = activity.season_id
     and score_date between week_start and week_start + 5
     and consistency_points >= 10;

  insert into public.daily_scores
    (user_id, season_id, score_date, consistency_points, evolution_points, volume_points)
  select activity.user_id, activity.season_id, score_date,
         least(10, sum(consistency_points)),
         least(25, sum(evolution_points)),
         least(20, sum(volume_points))
    from public.activity_score_contributions
   where user_id = activity.user_id
     and season_id = activity.season_id
     and score_date = activity.started_at::date
   group by score_date
  on conflict (user_id, season_id, score_date) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points,
        calculated_at = now();

  insert into public.weekly_scores
    (user_id, season_id, week_number, consistency_points, evolution_points,
     volume_points, bonus_points, completed_days)
  select activity.user_id, activity.season_id, week_number,
         least(60, coalesce(sum(consistency_points), 0)),
         least(25, coalesce(sum(evolution_points), 0)),
         least(20, coalesce(sum(volume_points), 0)),
         case when completed_days >= 5 then 15 else 0 end,
         least(6, completed_days)
    from public.activity_score_contributions
   where user_id = activity.user_id
     and season_id = activity.season_id
     and score_date between week_start and week_start + 5
  on conflict (user_id, season_id, week_number) do update
    set consistency_points = excluded.consistency_points,
        evolution_points = excluded.evolution_points,
        volume_points = excluded.volume_points,
        bonus_points = excluded.bonus_points,
        completed_days = excluded.completed_days,
        updated_at = now();
end;
$$;

-- ------------------------------------------- 4. Comprovante do PIX
create or replace function public.submit_payment_proof(p_payment_id uuid, p_storage_path text)
returns public.payments language plpgsql security definer set search_path = public, storage as $$
declare target public.payments; stored_object storage.objects;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_storage_path), '') is null
     or split_part(p_storage_path, '/', 1) <> auth.uid()::text
  then raise exception 'invalid proof path'; end if;

  select * into target from public.payments
   where id = p_payment_id and user_id = auth.uid();
  if target.id is null then raise exception 'payment not found'; end if;
  if target.payment_status not in ('pending', 'submitted', 'rejected') then
    raise exception 'payment cannot receive a new proof';
  end if;

  select * into stored_object from storage.objects
   where bucket_id = 'payment-proofs' and name = p_storage_path;
  if stored_object.id is null then raise exception 'proof file not found'; end if;
  if coalesce((stored_object.metadata ->> 'size')::bigint, 0) > 5242880 then
    raise exception 'proof file exceeds 5 MB';
  end if;
  if lower(coalesce(stored_object.metadata ->> 'mimetype', '')) not in
     ('image/jpeg', 'image/png', 'application/pdf') then
    raise exception 'unsupported proof file type';
  end if;

  update public.payments
     set proof_url = p_storage_path, payment_status = 'submitted',
         paid_at = now(), updated_at = now()
   where id = target.id returning * into target;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'payment', target.id, 'proof_submitted',
          jsonb_build_object('path', p_storage_path));

  return target;
end;
$$;

-- --------------------------------- 5. Temporada e status pelo ADM
create or replace function public.admin_upsert_season(
  p_season_id uuid, p_name text, p_description text, p_start_date date, p_end_date date,
  p_status public.season_status, p_entry_fee numeric, p_pix_key text
) returns public.seasons language plpgsql security definer set search_path = public as $$
declare result public.seasons;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_end_date <= p_start_date then raise exception 'end date must be after start date'; end if;

  if p_season_id is null then
    insert into public.seasons (name, description, start_date, end_date, status, entry_fee, pix_key)
    values (trim(p_name), p_description, p_start_date, p_end_date, p_status,
            greatest(0, p_entry_fee), nullif(trim(p_pix_key), ''))
    returning * into result;
  else
    update public.seasons
       set name = trim(p_name), description = p_description,
           start_date = p_start_date, end_date = p_end_date, status = p_status,
           entry_fee = greatest(0, p_entry_fee), pix_key = nullif(trim(p_pix_key), ''),
           updated_at = now()
     where id = p_season_id returning * into result;
  end if;

  if result.id is null then raise exception 'season not found'; end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', result.id,
          case when p_season_id is null then 'created' else 'updated' end,
          jsonb_build_object('status', result.status, 'entry_fee', result.entry_fee));

  return result;
end;
$$;

create or replace function public.admin_set_profile_status(
  p_user_id uuid, p_status public.profile_status
) returns public.profiles language plpgsql security definer set search_path = public as $$
declare result public.profiles;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  if p_user_id = auth.uid() then raise exception 'administrator cannot change own status'; end if;

  update public.profiles set status = p_status, updated_at = now()
   where id = p_user_id returning * into result;
  if result.id is null then raise exception 'profile not found'; end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'profile', p_user_id, 'status_changed',
          jsonb_build_object('status', p_status));

  return result;
end;
$$;

-- ------------------------------------------------------------ 6. Grants
revoke all on function public.submit_activity_session_with_proof(uuid, text, integer) from public;
revoke all on function public.submit_payment_proof(uuid, text) from public;
revoke all on function public.admin_upsert_season(uuid, text, text, date, date, public.season_status, numeric, text) from public;
revoke all on function public.admin_set_profile_status(uuid, public.profile_status) from public;

grant execute on function public.submit_activity_session_with_proof(uuid, text, integer) to authenticated;
grant execute on function public.submit_payment_proof(uuid, text) to authenticated;
grant execute on function public.admin_upsert_season(uuid, text, text, date, date, public.season_status, numeric, text) to authenticated;
grant execute on function public.admin_set_profile_status(uuid, public.profile_status) to authenticated;

commit;

notify pgrst, 'reload schema';
