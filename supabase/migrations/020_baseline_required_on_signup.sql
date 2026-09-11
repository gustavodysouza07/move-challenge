-- 020_baseline_required_on_signup.sql
-- O ponto de partida passa a ser parte da inscrição:
--   a) request_season_participation exige os dois números;
--   b) o participante não edita depois de enviar;
--   c) confirm_payment recusa se não houver baseline.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- ---------------------------------- 1. Inscrição com ponto de partida
drop function if exists public.request_season_participation(uuid);

create function public.request_season_participation(
  p_season_id uuid,
  p_average_active_minutes numeric,
  p_average_steps numeric
) returns public.payments language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_payment public.payments;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  if p_average_active_minutes is null or p_average_active_minutes < 0 or p_average_active_minutes > 480 then
    raise exception 'informe seus minutos de atividade por dia (0 a 480)';
  end if;
  if p_average_steps is null or p_average_steps < 0 or p_average_steps > 100000 then
    raise exception 'informe seus passos por dia (0 a 100000)';
  end if;

  select * into v_season from public.seasons
   where id = p_season_id and status = 'registration';
  if v_season.id is null then raise exception 'season is not accepting registrations'; end if;

  insert into public.season_participants (season_id, user_id, status)
  values (v_season.id, auth.uid(), 'pending_payment')
  on conflict (season_id, user_id) do nothing;

  insert into public.baseline_metrics (
    season_id, user_id, average_active_minutes, average_steps,
    baseline_period_start, baseline_period_end)
  values (
    v_season.id, auth.uid(), p_average_active_minutes, p_average_steps,
    v_season.start_date - 14, v_season.start_date - 1)
  on conflict (season_id, user_id) do nothing;

  insert into public.payments (season_id, user_id, amount, payment_method, payment_status, gateway)
  values (v_season.id, auth.uid(), v_season.entry_fee, 'pix', 'pending', 'manual')
  on conflict (user_id, season_id) do update set amount = excluded.amount
  returning * into v_payment;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'season', v_season.id, 'participation_requested',
          jsonb_build_object('minutes', p_average_active_minutes, 'steps', p_average_steps));

  return v_payment;
end;
$$;

-- --------------------------- 2. Participante não edita o próprio baseline
create or replace function public.upsert_baseline(
  p_average_active_minutes numeric, p_average_steps numeric
) returns public.baseline_metrics language plpgsql security definer set search_path = public as $$
begin
  raise exception 'o ponto de partida é informado na inscrição e não pode ser alterado';
end;
$$;

drop policy if exists "participants create own baseline" on public.baseline_metrics;
create policy "participants create own baseline" on public.baseline_metrics
  for insert to authenticated with check (false);

drop policy if exists "participants update own unfrozen baseline" on public.baseline_metrics;
create policy "participants cannot update baseline" on public.baseline_metrics
  for update to authenticated using (false) with check (false);

-- ------------------------- 3. PIX só é aprovado com ponto de partida
create or replace function public.confirm_payment(p_payment_id uuid)
returns public.payments language plpgsql security definer set search_path = public as $$
declare target public.payments;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into target from public.payments where id = p_payment_id;
  if target.payment_status = 'confirmed' then return target; end if;

  if not exists (select 1 from public.baseline_metrics
                  where season_id = target.season_id and user_id = target.user_id) then
    raise exception 'este participante ainda não informou o ponto de partida';
  end if;

  update public.payments
     set payment_status = 'confirmed', confirmed_at = now(),
         confirmed_by = auth.uid(), updated_at = now()
   where id = p_payment_id and payment_status in ('pending', 'submitted')
  returning * into target;
  if target.id is null then raise exception 'payment pending confirmation not found'; end if;

  update public.season_participants
     set status = 'active', approved_at = now()
   where season_id = target.season_id and user_id = target.user_id
     and status in ('pending_payment', 'pending_approval');

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'payment', target.id, 'confirmed',
          jsonb_build_object('season_id', target.season_id, 'user_id', target.user_id));

  return target;
end;
$$;

revoke all on function public.request_season_participation(uuid, numeric, numeric) from public;
grant execute on function public.request_season_participation(uuid, numeric, numeric) to authenticated;

commit;

notify pgrst, 'reload schema';