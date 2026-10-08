-- Observações, versões e renovação. Não altera o conteúdo dos pedidos existentes.
begin;
alter table public.orders add column revision integer not null default 1 check(revision>0);
alter table public.orders add column updated_at timestamptz not null default now();

create function private.valid_item_observations(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
  for item in select value from jsonb_array_elements(p->'items') loop
    if item ? 'observation' and (jsonb_typeof(item->'observation') is distinct from 'string'
      or length(item->>'observation')>500) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function private.valid_item_observations(jsonb) from public;
grant execute on function private.valid_item_observations(jsonb) to authenticated,service_role;
alter table public.orders add constraint orders_observations_valid check(private.valid_item_observations(payload));

create table public.order_revisions (
  order_id text not null references public.orders(id) on delete cascade,
  revision integer not null check(revision>0),
  payload jsonb not null,
  edited_by uuid references public.profiles(id) on delete set null,
  editor_name text not null,
  edited_at timestamptz not null default now(),
  reason text not null check(length(reason) between 1 and 500),
  request_id uuid,
  primary key(order_id,revision),
  unique(order_id,request_id)
);
alter table public.order_revisions enable row level security;
revoke all on public.order_revisions from public,anon,authenticated;
grant select on public.order_revisions to authenticated;
grant all on public.order_revisions to service_role;
create policy revisions_read on public.order_revisions for select to authenticated using(
  (select private.is_active()) and exists(
    select 1 from public.orders o where o.id=order_id
    and (o.owner_id=(select auth.uid()) or (select private.is_admin()))
  )
);

insert into public.order_revisions(order_id,revision,payload,editor_name,edited_at,reason)
  select id,revision,payload,'Registro anterior',created_at,'Pedido existente antes da ativação das revisões'
  from public.orders;

create function private.prepare_renewal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.payload ? 'renewedFromId' then
    if jsonb_typeof(new.payload->'renewedFromId') is distinct from 'string'
      or length(new.payload->>'renewedFromId') not between 1 and 100 then
      raise exception 'Referência do pedido original inválida.' using errcode='22023';
    end if;
    if not exists(select 1 from public.orders o where o.id=new.payload->>'renewedFromId'
      and (auth.uid() is null or (private.is_active() and
        (o.owner_id=auth.uid() or private.is_admin())))) then
      raise exception 'Pedido original indisponível para renovação.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.prepare_renewal() from public,anon,authenticated;
create trigger droptech_prepare_renewal before insert on public.orders
  for each row execute function private.prepare_renewal();

create function private.record_new_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare author text;
begin
  select coalesce(nullif(full_name,''),email) into author from public.profiles where id=auth.uid();
  insert into public.order_revisions(order_id,revision,payload,edited_by,editor_name,edited_at,reason)
    values(new.id,new.revision,new.payload,auth.uid(),coalesce(author,'Importação'),new.created_at,
      case when new.payload ? 'renewedFromId' then 'Renovação de pedido' else 'Pedido criado' end);
  return new;
end $$;
revoke all on function private.record_new_order() from public,anon,authenticated;
create trigger droptech_record_new_order after insert on public.orders
  for each row execute function private.record_new_order();
-- Navegadores não escolhem a versão nem a data registrada pelo servidor.
revoke insert on public.orders from authenticated;
grant insert(id,owner_id,payload) on public.orders to authenticated;

create function public.revise_order(p_order_id text,p_expected_revision integer,p_payload jsonb,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_order public.orders; prior public.order_revisions; next_payload jsonb; author text;
begin
  if not private.is_active() then raise exception 'Acesso não liberado.' using errcode='42501'; end if;
  select * into current_order from public.orders where id=p_order_id
    and (owner_id=auth.uid() or private.is_admin()) for update;
  if not found then raise exception 'Pedido não encontrado ou sem permissão.' using errcode='42501'; end if;
  if p_request_id is null or p_expected_revision is null or p_expected_revision<1
    or p_reason is null or length(trim(p_reason)) not between 3 and 500 then
    raise exception 'Informe o motivo da revisão (3 a 500 caracteres).' using errcode='22023';
  end if;
  next_payload:=p_payload-array['revision','ownerId','googleState','googleError','updatedAt'];
  if not private.valid_order(next_payload) or not private.valid_item_observations(next_payload)
    or next_payload->>'id' is distinct from p_order_id
    or next_payload->'date' is distinct from current_order.payload->'date'
    or next_payload->'createdAt' is distinct from current_order.payload->'createdAt'
    or next_payload->'renewedFromId' is distinct from current_order.payload->'renewedFromId' then
    raise exception 'Dados inválidos na revisão. Mantenha a identificação e a data original.' using errcode='22023';
  end if;
  select * into prior from public.order_revisions where order_id=p_order_id and request_id=p_request_id;
  if found then
    if prior.edited_by is distinct from auth.uid() or prior.payload<>next_payload
      or prior.reason<>trim(p_reason) or prior.revision<>p_expected_revision+1 then
      raise exception 'Identificação de tentativa já utilizada com outros dados.' using errcode='22023';
    end if;
    return jsonb_build_object('id',p_order_id,'revision',prior.revision);
  end if;
  if current_order.revision<>p_expected_revision then
    raise exception 'Este pedido foi revisado em outro aparelho. Atualize os pedidos antes de revisar novamente.'
      using errcode='40001';
  end if;
  if next_payload=current_order.payload then
    raise exception 'Altere algum dado antes de salvar a revisão.' using errcode='22023';
  end if;
  select coalesce(nullif(full_name,''),email) into author from public.profiles where id=auth.uid();
  update public.orders set payload=next_payload,revision=revision+1,updated_at=clock_timestamp(),
    google_state='not_sent',google_error='' where id=p_order_id;
  insert into public.order_revisions(order_id,revision,payload,edited_by,editor_name,reason,request_id)
    values(p_order_id,current_order.revision+1,next_payload,auth.uid(),author,trim(p_reason),p_request_id);
  return jsonb_build_object('id',p_order_id,'revision',current_order.revision+1);
end $$;
revoke all on function public.revise_order(text,integer,jsonb,text,uuid) from public,anon;
grant execute on function public.revise_order(text,integer,jsonb,text,uuid) to authenticated;

create or replace function public.workspace_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_active() then raise exception 'Acesso não liberado' using errcode='42501'; end if;
  select jsonb_build_object('environment',environment,'google_auto_send',google_auto_send,
    'username_login',true,'order_revisions',true,
    'google_configured',google_script_url<>'','google_script_url',case when private.is_admin() then google_script_url else '' end,
    'google_sheet_url',case when private.is_admin() then google_sheet_url else '' end)
    into result from public.app_settings where id;
  return result;
end $$;
revoke all on function public.workspace_settings() from public,anon;
grant execute on function public.workspace_settings() to authenticated;
commit;
