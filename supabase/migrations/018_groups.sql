-- 018_groups.sql
-- Grupos para acompanhar família e amigos dentro da mesma temporada.
-- Não alteram pontuação, inscrição, valor nem premiação: são recorte de ranking.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 40),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members(user_id);

-- Evita recursão nas policies: a checagem roda como definer.
create or replace function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members
                  where group_id = p_group_id and user_id = auth.uid());
$$;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

drop policy if exists "members view their groups" on public.groups;
create policy "members view their groups" on public.groups
  for select to authenticated using (public.is_group_member(id) or public.is_admin());

drop policy if exists "groups are written by rpc" on public.groups;
create policy "groups are written by rpc" on public.groups
  for insert to authenticated with check (false);

drop policy if exists "admins manage groups" on public.groups;
create policy "admins manage groups" on public.groups
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "members view group roster" on public.group_members;
create policy "members view group roster" on public.group_members
  for select to authenticated using (public.is_group_member(group_id) or public.is_admin());

drop policy if exists "group membership written by rpc" on public.group_members;
create policy "group membership written by rpc" on public.group_members
  for insert to authenticated with check (false);

drop policy if exists "admins manage group members" on public.group_members;
create policy "admins manage group members" on public.group_members
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------- Criar grupo
create or replace function public.create_group(p_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare v_group public.groups; v_code text; v_tries integer := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'group name must have at least 2 characters';
  end if;
  if (select count(*) from public.group_members where user_id = auth.uid()) >= 5 then
    raise exception 'you can take part in up to 5 groups';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := upper(substr(replace(encode(gen_random_bytes(8), 'base64'), '/', ''), 1, 6));
    v_code := regexp_replace(v_code, '[^A-Z0-9]', 'X', 'g');
    exit when not exists (select 1 from public.groups where invite_code = v_code);
    if v_tries > 20 then raise exception 'could not generate an invite code'; end if;
  end loop;

  insert into public.groups (name, owner_id, invite_code)
  values (trim(p_name), auth.uid(), v_code) returning * into v_group;

  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());

  return v_group;
end;
$$;

-- --------------------------------------------------------- Entrar
create or replace function public.join_group(p_invite_code text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare v_group public.groups;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_group from public.groups
   where invite_code = upper(trim(coalesce(p_invite_code, '')));
  if v_group.id is null then raise exception 'invite code not found'; end if;

  if exists (select 1 from public.group_members
              where group_id = v_group.id and user_id = auth.uid()) then
    return v_group;
  end if;

  if (select count(*) from public.group_members where user_id = auth.uid()) >= 5 then
    raise exception 'you can take part in up to 5 groups';
  end if;
  if (select count(*) from public.group_members where group_id = v_group.id) >= 50 then
    raise exception 'this group is full';
  end if;

  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());
  return v_group;
end;
$$;

-- --------------------------------------------------------- Sair
create or replace function public.leave_group(p_group_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_group public.groups; v_remaining integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;

  select * into v_group from public.groups where id = p_group_id;
  if v_group.id is null then raise exception 'group not found'; end if;

  delete from public.group_members where group_id = p_group_id and user_id = auth.uid();

  select count(*) into v_remaining from public.group_members where group_id = p_group_id;
  if v_remaining = 0 then
    delete from public.groups where id = p_group_id;
    return true;
  end if;

  -- Se quem saiu era o dono, a posse passa ao membro mais antigo.
  if v_group.owner_id = auth.uid() then
    update public.groups set owner_id = (
      select user_id from public.group_members
       where group_id = p_group_id order by joined_at limit 1)
     where id = p_group_id;
  end if;

  return false;
end;
$$;

-- ------------------------------------------- Ranking do grupo na temporada
create or replace function public.group_standing(p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_season public.seasons; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.is_group_member(p_group_id) and not public.is_admin() then
    raise exception 'not your group';
  end if;

  select * into v_season from public.seasons
   where status in ('registration', 'active')
     and current_date between start_date and end_date
   order by start_date desc limit 1;

  select jsonb_build_object(
    'season_name', coalesce(v_season.name, null),
    'members', coalesce((
      select jsonb_agg(entry order by entry ->> 'sort')
      from (
        select jsonb_build_object(
          'user_id', p.id, 'full_name', p.full_name, 'avatar_emoji', p.avatar_emoji,
          'points', coalesce(t.points, 0), 'days', coalesce(t.days, 0),
          'sort', lpad((999999 - coalesce(t.points, 0))::text, 7, '0') || p.full_name) as entry
        from public.group_members gm
        join public.profiles p on p.id = gm.user_id
        left join lateral (
          select sum(w.total_points + w.duel_points)::integer as points,
                 sum(w.completed_days)::integer as days
            from public.weekly_scores w
           where w.user_id = p.id and w.season_id = v_season.id) t on true
       where gm.group_id = p_group_id
      ) ordered), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.create_group(text) from public;
revoke all on function public.join_group(text) from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.group_standing(uuid) from public;
revoke all on function public.is_group_member(uuid) from public;

grant execute on function public.create_group(text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.group_standing(uuid) to authenticated;
grant execute on function public.is_group_member(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';