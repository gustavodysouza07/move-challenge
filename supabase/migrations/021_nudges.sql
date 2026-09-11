-- 021_nudges.sql
-- Mensagem contextual da Home: calcula a situação do participante e devolve
-- uma frase só, por prioridade, com o tom ajustado à faixa do ranking.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create or replace function public.my_nudge()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_season public.seasons;
  v_week integer; v_week_start date; v_week_end date;
  v_min_seconds integer; v_min_steps integer;
  v_today_done boolean; v_active_session public.activity_sessions;
  v_days_since integer; v_week_days integer;
  v_my_points integer; v_ahead_name text; v_ahead_gap integer;
  v_total integer; v_pos integer; v_band text;
  v_duel public.duels; v_duel_rival text; v_my_duel_days integer; v_rival_duel_days integer;
  v_wildcards integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_season from public.seasons
   where status in ('registration','active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;
  if v_season.id is null then return jsonb_build_object('kind', null); end if;

  if not exists (select 1 from public.season_participants
                  where season_id = v_season.id and user_id = auth.uid() and status = 'active') then
    return jsonb_build_object('kind', null);
  end if;

  v_min_seconds := coalesce((v_season.rules ->> 'daily_minutes')::integer, 30) * 60;
  v_min_steps   := coalesce((v_season.rules ->> 'daily_steps')::integer, 8000);
  v_week := public.current_season_week(v_season.id);
  v_week_start := v_season.start_date + ((v_week - 1) * 7);
  v_week_end := v_week_start + 5;

  -- Posição e faixa
  with totals as (
    select w.user_id, sum(w.total_points + w.duel_points)::integer as points
      from public.weekly_scores w
     where w.season_id = v_season.id group by w.user_id),
  ranked as (
    select t.*, row_number() over (order by t.points desc, t.user_id) as pos,
           count(*) over () as total from totals t)
  select r.points, r.pos, r.total into v_my_points, v_pos, v_total
    from ranked r where r.user_id = auth.uid();

  v_my_points := coalesce(v_my_points, 0);
  v_total := coalesce(v_total, 1);
  v_band := case
    when v_pos is null then 'bottom'
    when v_pos <= greatest(1, ceil(v_total / 3.0)) then 'top'
    when v_pos <= greatest(2, ceil(v_total * 2 / 3.0)) then 'mid'
    else 'bottom' end;

  -- Situação do dia
  select exists (
    select 1 from public.activity_score_contributions
     where user_id = auth.uid() and season_id = v_season.id
       and score_date = current_date and consistency_points > 0) into v_today_done;

  select * into v_active_session from public.activity_sessions
   where user_id = auth.uid() and status = 'active' limit 1;

  select count(distinct score_date) into v_week_days
    from public.activity_score_contributions
   where user_id = auth.uid() and season_id = v_season.id
     and score_date between v_week_start and v_week_end and consistency_points > 0;

  select coalesce(current_date - max(score_date), 99) into v_days_since
    from public.activity_score_contributions
   where user_id = auth.uid() and season_id = v_season.id and consistency_points > 0;

  select 2 - count(*) into v_wildcards from public.wildcards
   where user_id = auth.uid() and season_id = v_season.id;

  -- Duelo em disputa
  select * into v_duel from public.duels
   where season_id = v_season.id and week_number = v_week and status = 'accepted'
     and auth.uid() in (challenger_id, opponent_id) limit 1;

  if v_duel.id is not null then
    select p.full_name into v_duel_rival from public.profiles p
     where p.id = case when v_duel.challenger_id = auth.uid()
                       then v_duel.opponent_id else v_duel.challenger_id end;
    select count(distinct score_date) into v_my_duel_days
      from public.activity_score_contributions
     where user_id = auth.uid() and season_id = v_season.id
       and score_date between v_week_start and v_week_end and consistency_points > 0;
    select count(distinct score_date) into v_rival_duel_days
      from public.activity_score_contributions
     where user_id = case when v_duel.challenger_id = auth.uid()
                          then v_duel.opponent_id else v_duel.challenger_id end
       and season_id = v_season.id
       and score_date between v_week_start and v_week_end and consistency_points > 0;
  end if;

  -- Quem está logo acima
  with totals as (
    select w.user_id, sum(w.total_points + w.duel_points)::integer as points
      from public.weekly_scores w
     where w.season_id = v_season.id group by w.user_id)
  select p.full_name, t.points - v_my_points into v_ahead_name, v_ahead_gap
    from totals t join public.profiles p on p.id = t.user_id
   where t.points > v_my_points
   order by t.points asc limit 1;

  -- ---------------- Prioridade: streak > duelo > ranking > meta > retorno
  if not v_today_done and v_active_session.id is null
     and current_date between v_week_start and v_week_end
     and v_week_days >= 2 and extract(hour from now() at time zone 'America/Sao_Paulo') >= 17 then
    return jsonb_build_object('kind','streak','tone',v_band,'text', case v_band
      when 'top' then '🚨 Seu streak tá em risco. Sério mesmo que vai perder agora?'
      when 'mid' then '🚨 Seu streak está em risco. Ainda dá tempo.'
      else '🚨 Seu streak tá pendurado por um fio. Salva ele.' end);
  end if;

  if v_duel.id is not null then
    if coalesce(v_rival_duel_days,0) > coalesce(v_my_duel_days,0) then
      return jsonb_build_object('kind','duel','tone',v_band,'text',
        format('😬 Você tá perdendo o duelo pro %s por %s dia(s). Dá pra virar.',
               split_part(v_duel_rival,' ',1), v_rival_duel_days - v_my_duel_days));
    elsif coalesce(v_my_duel_days,0) = coalesce(v_rival_duel_days,0) then
      return jsonb_build_object('kind','duel','tone',v_band,'text',
        '🥊 Duelo empatado. Quem treinar amanhã leva.');
    else
      return jsonb_build_object('kind','duel','tone',v_band,'text',
        format('⚔️ Você tá na frente do %s no duelo. Não vacila.', split_part(v_duel_rival,' ',1)));
    end if;
  end if;

  if v_ahead_name is not null and v_ahead_gap <= 15 then
    return jsonb_build_object('kind','ranking','tone',v_band,'text', case v_band
      when 'top' then format('😤 O %s colou. %s pontos. Vai deixar?', split_part(v_ahead_name,' ',1), v_ahead_gap)
      when 'mid' then format('🍗 Bora frango! O %s está %s pontos na sua frente.', split_part(v_ahead_name,' ',1), v_ahead_gap)
      else format('👀 %s pontos e você sai da lanterna.', v_ahead_gap) end);
  end if;

  if v_today_done then
    if v_week_days >= 6 then
      return jsonb_build_object('kind','week','tone',v_band,'text','🏆 Semana perfeita. Seis de seis.');
    elsif v_week_days = 5 then
      return jsonb_build_object('kind','week','tone',v_band,'text','🎁 Cinco dias fechados: +15 de bônus garantido.');
    end if;
    return jsonb_build_object('kind','done','tone',v_band,'text', case v_band
      when 'top' then '🔥 Batida. De novo. Tá ficando sem graça pros outros.'
      when 'mid' then '🔥 Meta batida! Mais um dia no bolso.'
      else '🔥 Olha ele! Voltou a jogar.' end);
  end if;

  if v_days_since >= 3 and v_days_since < 99 then
    return jsonb_build_object('kind','comeback','tone',v_band,'text', case
      when v_wildcards > 0 then format('🧩 %s dias sumido. Você ainda tem %s coringa(s) guardado(s).', v_days_since, v_wildcards)
      else format('👋 %s dias sem aparecer. Bora recomeçar hoje?', v_days_since) end);
  end if;

  if v_active_session.id is not null then
    return jsonb_build_object('kind','running','tone',v_band,'text','⏳ Atividade rolando. Não para agora.');
  end if;

  return jsonb_build_object('kind','idle','tone',v_band,'text', case v_band
    when 'top' then '👟 Líder não folga. Bora?'
    when 'mid' then '🎯 Dia novo, meta nova. 30 minutos.'
    else '🐢 Devagar também é andar, mas hoje dá pra correr.' end);
end;
$$;

revoke all on function public.my_nudge() from public;
grant execute on function public.my_nudge() to authenticated;

commit;

notify pgrst, 'reload schema';