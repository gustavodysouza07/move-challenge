-- 025_fix_group_code.sql
-- create_group usava gen_random_bytes (pgcrypto, não habilitada).
-- Gera o código a partir de gen_random_uuid, que é nativo.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create or replace function public.create_group(p_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare
  v_group public.groups;
  v_code text;
  v_tries integer := 0;
  -- sem I, O, 0 e 1 para ninguém errar ao digitar
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_source text;
  v_index integer;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'o nome do grupo precisa de pelo menos 2 letras';
  end if;
  if (select count(*) from public.group_members where user_id = auth.uid()) >= 5 then
    raise exception 'você pode participar de até 5 grupos';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := '';
    v_source := replace(gen_random_uuid()::text, '-', '');
    for v_index in 1..6 loop
      v_code := v_code || substr(
        v_alphabet,
        (('x' || substr(v_source, v_index * 2 - 1, 2))::bit(8)::integer % 32) + 1,
        1);
    end loop;
    exit when not exists (select 1 from public.groups where invite_code = v_code);
    if v_tries > 20 then raise exception 'não foi possível gerar um código'; end if;
  end loop;

  insert into public.groups (name, owner_id, invite_code)
  values (trim(p_name), auth.uid(), v_code) returning * into v_group;

  insert into public.group_members (group_id, user_id) values (v_group.id, auth.uid());

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (auth.uid(), 'group', v_group.id, 'created', jsonb_build_object('name', v_group.name));

  return v_group;
end;
$$;

-- O código passa a ter letras e números; a checagem antiga já cobre os dois.
alter table public.groups drop constraint if exists groups_invite_code_check;
alter table public.groups add constraint groups_invite_code_check
  check (invite_code ~ '^[A-Z0-9]{6}$');

commit;

notify pgrst, 'reload schema';