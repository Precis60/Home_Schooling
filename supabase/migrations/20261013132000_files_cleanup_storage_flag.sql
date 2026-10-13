-- Deleting a file row must remove its private object. Supabase rejects
-- direct deletes from storage.objects unless this flag is set.
create or replace function hs_private.hs_files_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = 'hs-files'
    and name = old.storage_path;
  return old;
end;
$fn$;

revoke all on function hs_private.hs_files_cleanup() from public, anon, authenticated;
grant execute on function hs_private.hs_files_cleanup() to service_role;
