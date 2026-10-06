begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated,service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null default '' check(length(full_name)<=120),
  email text not null,
  role text not null default 'seller' check(role in ('seller','admin')),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

-- Never read the role or activation flag from user-editable auth metadata.
create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,email,full_name)
  values(new.id,new.email,left(coalesce(new.raw_user_meta_data->>'full_name',''),120));
  return new;
end $$;
create trigger droptech_profile after insert on auth.users for each row execute function private.new_profile();

create function private.is_active() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and active);
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and active and role='admin');
$$;
revoke all on function private.new_profile() from public;
revoke all on function private.is_active(),private.is_admin() from public;
grant execute on function private.is_active(),private.is_admin() to authenticated;

create function private.valid_order(p jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare i jsonb; k text; total numeric:=0; gross numeric; discount numeric; final numeric;
begin
  if jsonb_typeof(p)<>'object' or not (p ?& array['id','date','client','cnpj','ie','buyer','phone','items','gross','discountPct','discountVal','final','payment']) then return false; end if;
  if octet_length(p::text)>2000000 then return false; end if;
  foreach k in array array['id','date','client','cnpj','ie','buyer','phone','payment'] loop
    if jsonb_typeof(p->k) is distinct from 'string' then return false; end if;
  end loop;
  if length(p->>'id') not between 1 and 100 or length(p->>'client') not between 1 and 500
    or length(p->>'cnpj') not between 1 and 30 or length(p->>'buyer') not between 1 and 200
    or length(p->>'phone') not between 1 and 50 or length(p->>'payment') not between 1 and 120
    or length(p->>'ie')>100 or length(p->>'date')>100 then return false; end if;
  if jsonb_typeof(p->'items')<>'array' or jsonb_array_length(p->'items') not between 1 and 500 then return false; end if;
  for i in select value from jsonb_array_elements(p->'items') loop
    if jsonb_typeof(i) is distinct from 'object' or jsonb_typeof(i->'product') is distinct from 'string' or jsonb_typeof(i->'detail') is distinct from 'string' then return false; end if;
    if not(i ?& array['product','detail','meters','unitPrice','subtotal']) or length(i->>'product') not between 1 and 500 or length(i->>'detail')>500
      or jsonb_typeof(i->'meters')<>'number' or jsonb_typeof(i->'unitPrice')<>'number' or jsonb_typeof(i->'subtotal')<>'number' then return false; end if;
    if (i->>'meters')::numeric<=0 or (i->>'unitPrice')::numeric<=0 or (i->>'subtotal')::numeric<=0
      or abs((i->>'meters')::numeric*(i->>'unitPrice')::numeric-(i->>'subtotal')::numeric)>.02 then return false; end if;
    total:=total+(i->>'subtotal')::numeric;
  end loop;
  if jsonb_typeof(p->'gross')<>'number' or jsonb_typeof(p->'discountPct')<>'number' or jsonb_typeof(p->'discountVal')<>'number' or jsonb_typeof(p->'final')<>'number' then return false; end if;
  gross:=(p->>'gross')::numeric;discount:=(p->>'discountPct')::numeric;final:=(p->>'final')::numeric;
  return discount between 0 and 100 and gross<=1000000000 and final>=0 and abs(gross-total)<=.02
    and abs((p->>'discountVal')::numeric-gross*discount/100)<=.02 and abs(final-(gross-(p->>'discountVal')::numeric))<=.02;
exception when others then return false;
end $$;
revoke all on function private.valid_order(jsonb) from public;
grant execute on function private.valid_order(jsonb) to authenticated,service_role;

create table public.orders (
  id text primary key check(length(id) between 1 and 100),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  payload jsonb not null check(private.valid_order(payload) and payload->>'id'=id),
  created_at timestamptz not null default now(),
  google_state text not null default 'not_sent' check(google_state in ('not_sent','sent','error')),
  google_error text not null default ''
);
create index orders_owner_created on public.orders(owner_id,created_at,id);
create index orders_created on public.orders(created_at,id);

create table public.app_settings (
  id boolean primary key default true check(id),
  environment text not null default 'Teste' check(length(environment) between 1 and 80),
  google_script_url text not null default '' check(google_script_url='' or google_script_url ~ '^https://script\.google\.com/macros/s/[a-zA-Z0-9_-]+/exec$'),
  google_auto_send boolean not null default true,
  google_sheet_url text not null default ''
);
insert into public.app_settings(id) values(true);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.app_settings enable row level security;
revoke all on public.profiles,public.orders,public.app_settings from anon,authenticated;
grant select on public.profiles to authenticated;
grant select,insert,delete on public.orders to authenticated;
grant select,update(environment,google_script_url,google_auto_send) on public.app_settings to authenticated;
grant all on public.profiles,public.orders,public.app_settings to service_role;

create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()) or (select private.is_admin()));
create policy order_read on public.orders for select to authenticated using((select private.is_active()) and (owner_id=(select auth.uid()) or (select private.is_admin())));
create policy order_insert on public.orders for insert to authenticated with check(
  (select private.is_active()) and (owner_id=(select auth.uid()) or (select private.is_admin()))
  and exists(select 1 from public.profiles p where p.id=owner_id and p.active)
  and google_state='not_sent' and google_error=''
);
create policy order_delete on public.orders for delete to authenticated using((select private.is_active()) and (owner_id=(select auth.uid()) or (select private.is_admin())));
create policy settings_read on public.app_settings for select to authenticated using((select private.is_admin()));
create policy settings_update on public.app_settings for update to authenticated using((select private.is_admin())) with check((select private.is_admin()));

-- Sellers only receive environment/status flags; the shared Google URL is for administrators/server.
create function public.workspace_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_active() then raise exception 'Acesso não liberado' using errcode='42501'; end if;
  select jsonb_build_object('environment',environment,'google_auto_send',google_auto_send,
    'google_configured',google_script_url<>'','google_script_url',case when private.is_admin() then google_script_url else '' end,
    'google_sheet_url',case when private.is_admin() then google_sheet_url else '' end)
    into result from public.app_settings where id;
  return result;
end $$;
revoke all on function public.workspace_settings() from public,anon;
grant execute on function public.workspace_settings() to authenticated;

create function private.changed_google_destination() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.google_script_url is distinct from new.google_script_url then
    new.google_sheet_url:='';
    update public.orders set google_state='not_sent',google_error='';
  end if;
  return new;
end $$;
revoke all on function private.changed_google_destination() from public;
create trigger droptech_google_destination before update on public.app_settings for each row execute function private.changed_google_destination();
commit;
