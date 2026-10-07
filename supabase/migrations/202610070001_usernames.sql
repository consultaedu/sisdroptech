-- Atualização do projeto existente: mantém contas, senhas, pedidos e permissões.
begin;
alter table public.profiles add column username text;
alter table public.profiles add constraint profiles_username_format
  check(username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
alter table public.profiles add constraint profiles_username_unique unique(username);

create function private.available_username(account_email text) returns text
language plpgsql security definer set search_path='' as $$
declare base_name text; candidate text; suffix integer:=1;
begin
  base_name:=left(regexp_replace(lower(split_part(account_email,'@',1)),'[^a-z0-9._-]','','g'),32);
  base_name:=regexp_replace(base_name,'^[^a-z0-9]+','');
  if length(base_name)<3 then base_name:='usuario_'||base_name; end if;
  candidate:=base_name;
  while exists(select 1 from public.profiles where username=candidate) loop
    suffix:=suffix+1;
    candidate:=left(base_name,32-length(suffix::text)-1)||'_'||suffix::text;
  end loop;
  return candidate;
end $$;
revoke all on function private.available_username(text) from public,anon,authenticated;

do $$
declare account record;
begin
  for account in select id,email from public.profiles order by created_at,id loop
    update public.profiles set username=private.available_username(account.email) where id=account.id;
  end loop;
end $$;
alter table public.profiles alter column username set not null;

create or replace function private.new_profile() returns trigger
language plpgsql security definer set search_path='' as $$
declare requested text;
begin
  requested:=lower(trim(coalesce(new.raw_user_meta_data->>'username','')));
  if requested='' then requested:=private.available_username(new.email); end if;
  insert into public.profiles(id,email,full_name,username)
  values(new.id,new.email,left(coalesce(new.raw_user_meta_data->>'full_name',''),120),requested);
  return new;
end $$;
revoke all on function private.new_profile() from public,anon,authenticated;

-- Limite compartilhado entre instâncias do servidor: 10 tentativas por conta/minuto.
create table private.username_login_attempts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null,
  attempts integer not null
);
revoke all on private.username_login_attempts from public,anon,authenticated;
create function public.reserve_username_login(account_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare allowed boolean; instant timestamptz:=clock_timestamp();
begin
  insert into private.username_login_attempts(profile_id,window_start,attempts)
    values(account_id,instant,1)
  on conflict(profile_id) do update set
    window_start=case when username_login_attempts.window_start<=instant-interval '1 minute'
      then excluded.window_start else username_login_attempts.window_start end,
    attempts=case when username_login_attempts.window_start<=instant-interval '1 minute'
      then 1 else least(username_login_attempts.attempts+1,11) end
  returning attempts<=10 into allowed;
  return allowed;
end $$;
revoke all on function public.reserve_username_login(uuid) from public,anon,authenticated;
grant execute on function public.reserve_username_login(uuid) to service_role;

create or replace function public.workspace_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_active() then raise exception 'Acesso não liberado' using errcode='42501'; end if;
  select jsonb_build_object('environment',environment,'google_auto_send',google_auto_send,
    'username_login',true,
    'google_configured',google_script_url<>'','google_script_url',case when private.is_admin() then google_script_url else '' end,
    'google_sheet_url',case when private.is_admin() then google_sheet_url else '' end)
    into result from public.app_settings where id;
  return result;
end $$;
revoke all on function public.workspace_settings() from public,anon;
grant execute on function public.workspace_settings() to authenticated;
commit;
