-- Apply this repair once to the existing Supabase database.
-- Replaces only the destination-change trigger function; preserves orders and permissions.
begin;

create or replace function private.changed_google_destination()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.google_script_url is distinct from new.google_script_url then
    new.google_sheet_url := '';
    update public.orders
    set google_state = 'not_sent', google_error = ''
    where google_state <> 'not_sent' or google_error <> '';
  end if;
  return new;
end;
$$;

revoke all on function private.changed_google_destination() from public;
commit;
