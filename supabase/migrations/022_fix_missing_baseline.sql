-- 022_fix_missing_baseline.sql
-- a) quem se inscreveu antes da 020 pode informar o ponto de partida que falta;
-- b) o admin passa a criar ou corrigir o ponto de partida pelo painel.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

-- Participante informa o que ficou faltando. Só insere: nunca altera o que já existe.
create or replace function public.set_missing_baseline(
  p_average_active_minutes numeric, p_average_steps numeric
) returns public.baseline_metrics language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_row public.baseline_metrics;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  if p_average_active_minutes is null or p_average_active_minutes < 0 or p_average_active_minutes > 480 then
    raise exception 'informe seus minutos de atividade por dia (0 a 480)';
  end if;
  if p_average_steps is null or p_average_steps < 0 or p_average_steps > 100000 then
    raise exception 'informe seus passos por dia (0 a 100000)';
  end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
   order by start_date limit 1;
  if v_season.id is null then raise exception 'no season open'; end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid()) then
    raise exception 'request participation first';
  end if;

  if exists (select 1 from public.baseline_metrics
              where season_id = v_season.id and user_id = auth.uid()) then
    raise exception 'seu ponto de partida já foi registrado e não pode ser alterado';
  end if;

  insert into public.baseline_metrics (
    season_id, user_id, average_active_minutes, average_steps,
    baseline_period_start, baseline_period_end)
  values (v_season.id, auth.uid(), p_average_active_minutes, p_average_steps,
          v_season.start_date - 14, v_season.start_date - 1)
  returning * into v_row;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'baseline', v_row.id, 'filled_late',
          jsonb_build_object('minutes', p_average_active_minutes, 'steps', p_average_steps));

  return v_row;
end;
$$;

-- Admin cria ou corrige, enquanto não estiver congelado.
create or replace function public.admin_set_baseline(
  p_season_id uuid, p_user_id uuid,
  p_average_active_minutes numeric, p_average_steps numeric
) returns public.baseline_metrics language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_row public.baseline_metrics;
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;

  select * into v_season from public.seasons where id = p_season_id;
  if v_season.id is null then raise exception 'season not found'; end if;

  if exists (select 1 from public.baseline_metrics
              where season_id = p_season_id and user_id = p_user_id and frozen_at is not null) then
    raise exception 'este ponto de partida já foi congelado';
  end if;

  insert into public.baseline_metrics (
    season_id, user_id, average_active_minutes, average_steps,
    baseline_period_start, baseline_period_end)
  values (p_season_id, p_user_id, p_average_active_minutes, p_average_steps,
          v_season.start_date - 14, v_season.start_date - 1)
  on conflict (season_id, user_id) do update
    set average_active_minutes = excluded.average_active_minutes,
        average_steps = excluded.average_steps,
        updated_at = now()
  returning * into v_row;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'baseline', v_row.id, 'set_by_admin',
          jsonb_build_object('user_id', p_user_id, 'minutes', p_average_active_minutes,
                             'steps', p_average_steps));

  return v_row;
end;
$$;

-- Lista quem ainda não tem ponto de partida, para o painel.
create or replace function public.admin_missing_baselines(p_season_id uuid)
returns table (user_id uuid, full_name text, payment_status text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin access required'; end if;
  return query
  select sp.user_id, p.full_name, coalesce(pay.payment_status::text, 'sem cobrança')
    from public.season_participants sp
    join public.profiles p on p.id = sp.user_id
    left join public.payments pay on pay.user_id = sp.user_id and pay.season_id = sp.season_id
   where sp.season_id = p_season_id
     and not exists (select 1 from public.baseline_metrics b
                      where b.season_id = sp.season_id and b.user_id = sp.user_id)
   order by p.full_name;
end;
$$;

revoke all on function public.set_missing_baseline(numeric, numeric) from public;
revoke all on function public.admin_set_baseline(uuid, uuid, numeric, numeric) from public;
revoke all on function public.admin_missing_baselines(uuid) from public;

grant execute on function public.set_missing_baseline(numeric, numeric) to authenticated;
grant execute on function public.admin_set_baseline(uuid, uuid, numeric, numeric) to authenticated;
grant execute on function public.admin_missing_baselines(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';