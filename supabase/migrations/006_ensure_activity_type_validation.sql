-- Ensures server-side activity validation exists before the activity RPC uses it.
create or replace function public.validate_activity_type(p_activity_type text)
returns boolean
language sql
immutable
as $$
  select trim(p_activity_type) in (
    'Caminhada leve', 'Caminhada rápida / inclinação', 'Musculação moderada',
    'Musculação pesada', 'Bike / spinning', 'Natação', 'Corrida',
    'Funcional / HIIT', 'Yoga / alongamento'
  );
$$;

revoke all on function public.validate_activity_type(text) from public;