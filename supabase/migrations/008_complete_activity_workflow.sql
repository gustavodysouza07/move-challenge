-- 008_complete_activity_workflow.sql
-- Fecha o ciclo de atividade: pausas auditáveis, duração líquida do tempo
-- pausado, cancelamento de sessão e comprovante obrigatório.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ---------------------------------------------------------------- 1. Pausas
create table if not exists public.activity_pauses (
  id uuid primary key default gen_random_uuid(),
  activity_session_id uuid not null references public.activity_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pause_started_at timestamptz not null default now(),
  pause_ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (pause_ended_at is null or pause_ended_at >= pause_started_at)
);

create unique index if not exists activity_pauses_one_open_idx
  on public.activity_pauses(activity_session_id) where pause_ended_at is null;

create index if not exists activity_pauses_session_idx
  on public.activity_pauses(activity_session_id);

-- ------------------------------------------------------ 2. Duração líquida
-- duration_seconds JÁ é coluna gerada, mas a expressão instalada não desconta
-- paused_seconds — o tempo pausado contaria como treino. Como coluna gerada é
-- derivada, dropar e recriar apenas recalcula: nenhum dado é perdido.
alter table public.activity_sessions
  add column if not exists paused_seconds integer not null default 0;

alter table public.activity_sessions drop column if exists effective_duration_seconds;
alter table public.activity_sessions drop column if exists duration_seconds;

alter table public.activity_sessions
  add column duration_seconds integer generated always as (
    case when ended_at is null then null
         else greatest(0, extract(epoch from (ended_at - started_at))::integer - paused_seconds)
    end
  ) stored;

-- -------------------------------------------------------------- 3. Iniciar
create or replace function public.start_activity_session(p_activity_type text)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare current_season public.seasons; created_session public.activity_sessions;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.validate_activity_type(p_activity_type) then raise exception 'unsupported activity type'; end if;

  select * into current_season from public.seasons
   where status in ('registration', 'active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if current_season.id is null then raise exception 'no active season'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = current_season.id and user_id = auth.uid() and status = 'active')
  then raise exception 'active participation required'; end if;

  insert into public.activity_sessions (user_id, season_id, activity_type, started_at, status, source)
  values (auth.uid(), current_season.id, trim(p_activity_type), now(), 'active', 'move_checkin')
  returning * into created_session;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', created_session.id, 'started',
          jsonb_build_object('activity_type', created_session.activity_type));

  return created_session;
exception when unique_violation then
  raise exception 'an active activity session already exists';
end;
$$;

-- --------------------------------------------------------------- 4. Pausar
create or replace function public.pause_activity_session(p_session_id uuid)
returns public.activity_pauses language plpgsql security definer set search_path = public as $$
declare created_pause public.activity_pauses;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  if not exists (select 1 from public.activity_sessions
                  where id = p_session_id and user_id = auth.uid() and status = 'active')
  then raise exception 'active session not found'; end if;

  insert into public.activity_pauses (activity_session_id, user_id, pause_started_at)
  values (p_session_id, auth.uid(), now()) returning * into created_pause;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action)
  values (auth.uid(), 'activity_session', p_session_id, 'paused');

  return created_pause;
exception when unique_violation then
  raise exception 'activity is already paused';
end;
$$;

-- -------------------------------------------------------------- 5. Retomar
create or replace function public.resume_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare
  resumed_session public.activity_sessions;
  pause_row public.activity_pauses;
  resumed_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into pause_row from public.activity_pauses
   where activity_session_id = p_session_id and user_id = auth.uid() and pause_ended_at is null
   for update;
  if pause_row.id is null then raise exception 'open pause not found'; end if;

  update public.activity_pauses set pause_ended_at = resumed_at where id = pause_row.id;

  update public.activity_sessions
     set paused_seconds = paused_seconds
           + greatest(0, extract(epoch from (resumed_at - pause_row.pause_started_at))::integer),
         updated_at = now()
   where id = p_session_id and user_id = auth.uid() and status = 'active'
  returning * into resumed_session;
  if resumed_session.id is null then raise exception 'active session not found'; end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action)
  values (auth.uid(), 'activity_session', p_session_id, 'resumed');

  return resumed_session;
end;
$$;

-- ------------------------------------------------------------ 6. Finalizar
-- Fecha pausa aberta automaticamente: recusar finalização com pausa aberta
-- deixaria o usuário sem saída, já que só pode haver uma sessão ativa.
create or replace function public.finish_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare
  finished_session public.activity_sessions;
  open_pause public.activity_pauses;
  extra_paused integer := 0;
  finished_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into open_pause from public.activity_pauses
   where activity_session_id = p_session_id and user_id = auth.uid() and pause_ended_at is null
   for update;

  if open_pause.id is not null then
    update public.activity_pauses set pause_ended_at = finished_at where id = open_pause.id;
    extra_paused := greatest(0, extract(epoch from (finished_at - open_pause.pause_started_at))::integer);
  end if;

  update public.activity_sessions
     set paused_seconds = paused_seconds + extra_paused,
         ended_at = finished_at,
         status = 'completed',
         updated_at = finished_at
   where id = p_session_id and user_id = auth.uid() and status = 'active'
     and started_at <= finished_at
     and extract(epoch from (finished_at - started_at)) <= 86400
  returning * into finished_session;

  if finished_session.id is null then
    raise exception 'active session not found or invalid duration';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', finished_session.id, 'finished',
          jsonb_build_object('duration_seconds', finished_session.duration_seconds,
                             'paused_seconds', finished_session.paused_seconds));

  return finished_session;
end;
$$;

-- ------------------------------------------------------------- 7. Cancelar
-- Sem isto, uma sessão esquecida acima de 24h bloqueia o usuário para sempre.
create or replace function public.cancel_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare cancelled_session public.activity_sessions; cancelled_at timestamptz := now();
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  update public.activity_pauses set pause_ended_at = cancelled_at
   where activity_session_id = p_session_id and user_id = auth.uid() and pause_ended_at is null;

  update public.activity_sessions
     set ended_at = cancelled_at, status = 'cancelled', updated_at = cancelled_at
   where id = p_session_id and user_id = auth.uid() and status = 'active'
  returning * into cancelled_session;
  if cancelled_session.id is null then raise exception 'active session not found'; end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action)
  values (auth.uid(), 'activity_session', cancelled_session.id, 'cancelled');

  return cancelled_session;
end;
$$;

-- -------------------------------------------- 8. Envio com comprovante real
create unique index if not exists activity_proofs_session_unique_idx
  on public.activity_proofs(activity_session_id);

create or replace function public.submit_activity_session(p_session_id uuid)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
begin
  raise exception 'activity proof is required';
end;
$$;

create or replace function public.submit_activity_session_with_proof(p_session_id uuid, p_storage_path text)
returns public.activity_sessions language plpgsql security definer set search_path = public, storage as $$
declare target public.activity_sessions; stored_object storage.objects;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if nullif(trim(p_storage_path), '') is null
     or split_part(p_storage_path, '/', 1) <> auth.uid()::text
  then raise exception 'invalid proof path'; end if;

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

  update public.activity_sessions set status = 'pending_validation', updated_at = now()
   where id = target.id returning * into target;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', target.id, 'submitted_for_validation',
          jsonb_build_object('path', p_storage_path));

  return target;
exception when unique_violation then
  raise exception 'activity proof already submitted';
end;
$$;

-- ----------------------------------------------------------- 9. RLS/Storage
alter table public.activity_pauses enable row level security;
drop policy if exists "participants view own pauses" on public.activity_pauses;
create policy "participants view own pauses" on public.activity_pauses
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admins manage pauses" on public.activity_pauses;
create policy "admins manage pauses" on public.activity_pauses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.activity_proofs enable row level security;
drop policy if exists "participants add own activity proofs" on public.activity_proofs;
create policy "participants add own activity proofs" on public.activity_proofs
  for insert to authenticated with check (false);

insert into storage.buckets (id, name, public)
values ('activity-proofs', 'activity-proofs', false) on conflict (id) do nothing;

drop policy if exists "participants upload own activity proof" on storage.objects;
create policy "participants upload own activity proof" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'activity-proofs'
              and (storage.foldername(name))[1] = auth.uid()::text
              and lower(storage.extension(name)) in ('jpg','jpeg','png','webp','pdf'));

drop policy if exists "participants view own activity proof" on storage.objects;
create policy "participants view own activity proof" on storage.objects
  for select to authenticated
  using (bucket_id = 'activity-proofs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ------------------------------------------------------------- 10. Grants
revoke all on function public.start_activity_session(text) from public;
revoke all on function public.pause_activity_session(uuid) from public;
revoke all on function public.resume_activity_session(uuid) from public;
revoke all on function public.finish_activity_session(uuid) from public;
revoke all on function public.cancel_activity_session(uuid) from public;
revoke all on function public.submit_activity_session(uuid) from public;
revoke all on function public.submit_activity_session_with_proof(uuid, text) from public;

grant execute on function public.start_activity_session(text) to authenticated;
grant execute on function public.pause_activity_session(uuid) to authenticated;
grant execute on function public.resume_activity_session(uuid) to authenticated;
grant execute on function public.finish_activity_session(uuid) to authenticated;
grant execute on function public.cancel_activity_session(uuid) to authenticated;
grant execute on function public.submit_activity_session(uuid) to authenticated;
grant execute on function public.submit_activity_session_with_proof(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';