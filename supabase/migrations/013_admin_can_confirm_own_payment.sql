-- 013_admin_can_confirm_own_payment.sql
-- O trigger de proteção bloqueava o admin ao confirmar o próprio pagamento.
-- Passa a liberar quando quem executa é administrador — a ação continua
-- registrada em audit_logs com o id de quem aprovou.
-- Aplicar manualmente no SQL Editor, após revisão.

begin;

create or replace function public.prevent_participant_payment_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if auth.uid() = old.user_id and (
       new.user_id is distinct from old.user_id
    or new.season_id is distinct from old.season_id
    or new.amount is distinct from old.amount
    or new.payment_method is distinct from old.payment_method
    or new.gateway is distinct from old.gateway
    or new.payment_status in ('confirmed', 'rejected', 'refunded')
    or new.confirmed_by is distinct from old.confirmed_by
    or new.confirmed_at is distinct from old.confirmed_at
  ) then
    raise exception 'protected payment fields cannot be changed by the participant';
  end if;

  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';