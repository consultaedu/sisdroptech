-- Permite excluir uma conta pelo Supabase quando ela não possui pedidos.
-- Esta atualização não exclui nenhuma conta ou pedido.
begin;

alter table public.profiles drop constraint profiles_id_fkey;
alter table public.profiles add constraint profiles_id_fkey
  foreign key(id) references auth.users(id) on delete cascade;

-- orders.owner_id continua ON DELETE RESTRICT: o histórico impede a exclusão.
-- O último administrador ativo precisa permanecer para administrar o sistema.
create function private.protect_admin_deletion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.role='admin' and old.active then
    perform pg_advisory_xact_lock(20261007,3);
    if not exists(
      select 1 from public.profiles
      where role='admin' and active and id<>old.id
    ) then
      raise exception 'Não é possível excluir o último administrador ativo.'
        using errcode='23514';
    end if;
  end if;
  return old;
end $$;
revoke all on function private.protect_admin_deletion() from public,anon,authenticated;

create trigger droptech_protect_admin_deletion
  before delete on public.profiles
  for each row execute function private.protect_admin_deletion();

commit;
