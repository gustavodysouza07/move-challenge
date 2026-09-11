-- 014_duel_scoreboard.sql
-- Placar ao vivo do duelo, com o dia a dia da semana.
-- Só o desafiante, o desafiado ou um admin conseguem consultar.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create or replace function public.duel_scoreboard(p_duel_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_duel public.duels;
  v_season public.seasons;
  v_week_start date;
  v_week_end date;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_duel from public.duels where id = p_duel_id;
  if v_duel.id is null then raise exception 'duel not found'; end if;

  if auth.uid() not in (v_duel.challenger_id, v_duel.opponent_id) and not public.is_admin() then
    raise exception 'not your duel';
  end if;

  select * into v_season from public.seasons where id = v_duel.season_id;
  v_week_start := v_season.start_date + ((v_duel.week_number - 1) * 7);
  v_week_end := v_week_start + 5;

  with per_user as (
    select c.user_id,
           count(distinct c.score_date) filter (where c.consistency_points > 0) as days,
           coalesce(sum(c.consistency_points), 0) as consistency,
           coalesce(sum(c.volume_points), 0) as volume,
           coalesce(jsonb_agg(distinct c.score_date)
                    filter (where c.consistency_points > 0), '[]'::jsonb) as dates
      from public.activity_score_contributions c
     where c.season_id = v_duel.season_id
       and c.user_id in (v_duel.challenger_id, v_duel.opponent_id)
       and c.score_date between v_week_start and v_week_end
     group by c.user_id
  )
  select jsonb_build_object(
    'week_number', v_duel.week_number,
    'week_start', v_week_start,
    'week_end', v_week_end,
    'days_left', greatest(0, (v_week_end - current_date) + 1),
    'challenger', jsonb_build_object(
      'user_id', v_duel.challenger_id,
      'days', coalesce((select days from per_user where user_id = v_duel.challenger_id), 0),
      'consistency', coalesce((select consistency from per_user where user_id = v_duel.challenger_id), 0),
      'volume', coalesce((select volume from per_user where user_id = v_duel.challenger_id), 0),
      'dates', coalesce((select dates from per_user where user_id = v_duel.challenger_id), '[]'::jsonb)),
    'opponent', jsonb_build_object(
      'user_id', v_duel.opponent_id,
      'days', coalesce((select days from per_user where user_id = v_duel.opponent_id), 0),
      'consistency', coalesce((select consistency from per_user where user_id = v_duel.opponent_id), 0),
      'volume', coalesce((select volume from per_user where user_id = v_duel.opponent_id), 0),
      'dates', coalesce((select dates from per_user where user_id = v_duel.opponent_id), '[]'::jsonb))
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.duel_scoreboard(uuid) from public;
grant execute on function public.duel_scoreboard(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';