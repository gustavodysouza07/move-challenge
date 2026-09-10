-- Use the transaction timestamp for the start time so it cannot be ahead of
-- the activity_sessions_started_at_check constraint.
create or replace function public.start_activity_session(p_activity_type text)
returns public.activity_sessions language plpgsql security definer set search_path = public as $$
declare
  current_season public.seasons;
  created_session public.activity_sessions;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.validate_activity_type(p_activity_type) then raise exception 'unsupported activity type'; end if;
  select * into current_season
  from public.seasons
  where status in ('registration', 'active')
    and current_date between start_date and end_date
  order by start_date desc
  limit 1;
  if current_season.id is null then raise exception 'no active season'; end if;
  if not exists (select 1 from public.season_participants where season_id = current_season.id and user_id = auth.uid() and status = 'active') then raise exception 'active participation required'; end if;
  insert into public.activity_sessions (user_id, season_id, activity_type, started_at, status, source)
  values (auth.uid(), current_season.id, trim(p_activity_type), now(), 'active', 'move_checkin')
  returning * into created_session;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'activity_session', created_session.id, 'started', jsonb_build_object('activity_type', created_session.activity_type));
  return created_session;
exception when unique_violation then
  raise exception 'an active activity session already exists';
end;
$$;

revoke all on function public.start_activity_session(text) from public;
grant execute on function public.start_activity_session(text) to authenticated;