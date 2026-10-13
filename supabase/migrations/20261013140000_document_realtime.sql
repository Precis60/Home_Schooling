-- Live document collaboration for the Home Schooling project only
-- (ref rkmrzflpgrdqnfdexens).
--
-- Private Realtime channels, not a postgres_changes publication. Postgres
-- Changes delivers DELETE events to every subscriber of the table and cannot
-- apply RLS to them, so a student could learn the id of a document they
-- cannot read. Library events are written to each reader's private inbox
-- topic instead. Document presence uses topic doc:<uuid>, and
-- realtime.messages policies allow that topic only when the caller can
-- already select the document.
--
-- Saves that change the title or body must advance revision by exactly 1.
-- Two overlapping saves cannot silently overwrite each other.

alter table public.hs_documents
  add column if not exists revision bigint not null default 1;

create or replace function hs_private.hs_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  folder_owner uuid;
begin
  new.title := btrim(new.title);
  if new.title is null or char_length(new.title) < 1 or char_length(new.title) > 200 then
    raise exception 'document title is required';
  end if;
  if new.body_html is null or btrim(new.body_html) = '' then
    new.body_html := '<p></p>';
  end if;
  if char_length(new.body_html) > 1000000 then
    raise exception 'document is too large';
  end if;
  new.owner_email := lower(btrim(new.owner_email));
  if new.owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'document owner email is invalid';
  end if;
  if new.folder_id is not null then
    select f.owner_id into folder_owner
    from public.hs_doc_folders f
    where f.id = new.folder_id;
    if folder_owner is null or folder_owner is distinct from new.owner_id then
      raise exception 'folder must belong to the document owner';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.revision := 1;
  elsif new.title is distinct from old.title or new.body_html is distinct from old.body_html then
    if coalesce(new.revision, 0) is distinct from old.revision + 1 then
      raise exception 'document revision conflict';
    end if;
  else
    new.revision := old.revision;
  end if;
  if auth.uid() is null or public.hs_is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if not hs_private.hs_can_insert_document(new.owner_id, new.owner_email, new.folder_id) then
      raise exception 'students can only create their own documents';
    end if;
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id or new.owner_email is distinct from old.owner_email then
    raise exception 'owners cannot be reassigned';
  end if;
  if old.owner_id = auth.uid() then
    if new.folder_id is not null and hs_private.hs_folder_permission(new.folder_id) is distinct from 'edit' then
      raise exception 'not allowed to move the document to this folder';
    end if;
    return new;
  end if;
  if old.folder_id is not null and hs_private.hs_folder_permission(old.folder_id) = 'edit' then
    if new.folder_id is null or hs_private.hs_folder_permission(new.folder_id) is distinct from 'edit' then
      raise exception 'shared editors can only move documents between folders they can edit';
    end if;
    return new;
  end if;
  if exists (
    select 1 from public.hs_document_shares s
    where s.document_id = old.id
      and s.shared_with_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and s.permission = 'edit'
  ) then
    if new.folder_id is distinct from old.folder_id then
      raise exception 'shared editors cannot move or reassign documents';
    end if;
    return new;
  end if;
  raise exception 'not allowed to edit this document';
end;
$fn$;

revoke all on function hs_private.hs_documents_guard() from public, anon, authenticated;
grant execute on function hs_private.hs_documents_guard() to service_role;

create or replace function hs_private.hs_topic_document_id(topic text)
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $fn$
begin
  if topic is null or topic !~ '^doc:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return substring(topic from 5)::uuid;
end;
$fn$;

revoke all on function hs_private.hs_topic_document_id(text) from public, anon;
grant execute on function hs_private.hs_topic_document_id(text) to authenticated;

-- Invoker so the document SELECT policies decide. A student who cannot read
-- the row cannot join doc:<id>.
create or replace function hs_private.hs_can_subscribe_document(topic text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $fn$
  select exists (
    select 1
    from public.hs_documents d
    where d.id = hs_private.hs_topic_document_id(topic)
  );
$fn$;

revoke all on function hs_private.hs_can_subscribe_document(text) from public, anon;
grant execute on function hs_private.hs_can_subscribe_document(text) to authenticated;

create or replace function hs_private.hs_access_user_ids(owner uuid, folder uuid, extra_emails text[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $fn$
  with recursive chain as (
    select f.id, f.parent_id
    from public.hs_doc_folders f
    where f.id = folder
    union all
    select parent.id, parent.parent_id
    from public.hs_doc_folders parent
    join chain on parent.id = chain.parent_id
  ),
  emails as (
    select lower(btrim(email)) as email
    from unnest(coalesce(extra_emails, array[]::text[])) as email
    where email is not null and btrim(email) <> ''
    union
    select s.shared_with_email
    from public.hs_folder_shares s
    where s.folder_id in (select chain.id from chain)
  )
  select coalesce(array_agg(distinct people.user_id), array[]::uuid[])
  from (
    select owner as user_id
    union
    select u.id
    from auth.users u
    where coalesce(u.raw_app_meta_data ->> 'role', '') = 'manager'
    union
    select u.id
    from auth.users u
    join emails on lower(u.email) = emails.email
  ) people
  where people.user_id is not null;
$fn$;

revoke all on function hs_private.hs_access_user_ids(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function hs_private.hs_access_user_ids(uuid, uuid, text[]) to service_role;

create or replace function hs_private.hs_realtime_emit(recipients uuid[], doc_topic text, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  recipient uuid;
  seen uuid[] := array[]::uuid[];
begin
  if doc_topic is not null then
    perform realtime.send(payload, 'changed', doc_topic, true);
  end if;
  if recipients is null then
    return;
  end if;
  foreach recipient in array recipients loop
    if recipient is null or recipient = any(seen) then
      continue;
    end if;
    seen := seen || recipient;
    perform realtime.send(payload, 'changed', 'inbox:' || recipient::text, true);
  end loop;
end;
$fn$;

revoke all on function hs_private.hs_realtime_emit(uuid[], text, jsonb) from public, anon, authenticated;
grant execute on function hs_private.hs_realtime_emit(uuid[], text, jsonb) to service_role;

create or replace function hs_private.hs_realtime_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  row_id uuid;
  owner uuid;
  folder uuid;
  previous_folder uuid;
  emails text[] := array[]::text[];
  recipients uuid[];
  payload jsonb;
  doc_topic text := null;
  share_email text;
begin
  if tg_op = 'INSERT' then
    previous_folder := null;
  end if;

  if tg_table_name = 'hs_documents' then
    if tg_op = 'DELETE' then
      row_id := old.id;
      owner := old.owner_id;
      folder := old.folder_id;
      payload := jsonb_build_object('kind', 'document', 'id', row_id, 'op', tg_op, 'revision', old.revision);
    else
      row_id := new.id;
      owner := new.owner_id;
      folder := new.folder_id;
      if tg_op = 'UPDATE' then
        previous_folder := old.folder_id;
      end if;
      payload := jsonb_build_object('kind', 'document', 'id', row_id, 'op', tg_op, 'revision', new.revision);
    end if;
    select coalesce(array_agg(s.shared_with_email), array[]::text[])
      into emails
    from public.hs_document_shares s
    where s.document_id = row_id;
    doc_topic := 'doc:' || row_id::text;
  elsif tg_table_name = 'hs_doc_folders' then
    if tg_op = 'DELETE' then
      row_id := old.id;
      owner := old.owner_id;
      previous_folder := old.parent_id;
    else
      row_id := new.id;
      owner := new.owner_id;
      if tg_op = 'UPDATE' then
        previous_folder := old.parent_id;
      end if;
    end if;
    folder := row_id;
    payload := jsonb_build_object('kind', 'folder', 'id', row_id, 'op', tg_op);
  elsif tg_table_name = 'hs_files' then
    if tg_op = 'DELETE' then
      row_id := old.id;
      owner := old.owner_id;
      folder := old.folder_id;
    else
      row_id := new.id;
      owner := new.owner_id;
      folder := new.folder_id;
      if tg_op = 'UPDATE' then
        previous_folder := old.folder_id;
      end if;
    end if;
    payload := jsonb_build_object('kind', 'file', 'id', row_id, 'op', tg_op);
  elsif tg_table_name = 'hs_document_shares' then
    if tg_op = 'DELETE' then
      row_id := old.document_id;
      share_email := old.shared_with_email;
    else
      row_id := new.document_id;
      share_email := new.shared_with_email;
    end if;
    select d.owner_id, d.folder_id into owner, folder
    from public.hs_documents d
    where d.id = row_id;
    select coalesce(array_agg(s.shared_with_email), array[]::text[])
      into emails
    from public.hs_document_shares s
    where s.document_id = row_id;
    emails := emails || share_email;
    payload := jsonb_build_object('kind', 'share', 'id', row_id, 'op', tg_op);
  elsif tg_table_name = 'hs_folder_shares' then
    if tg_op = 'DELETE' then
      row_id := old.folder_id;
      share_email := old.shared_with_email;
    else
      row_id := new.folder_id;
      share_email := new.shared_with_email;
    end if;
    select f.owner_id into owner
    from public.hs_doc_folders f
    where f.id = row_id;
    folder := row_id;
    emails := array[share_email];
    payload := jsonb_build_object('kind', 'folder', 'id', row_id, 'op', tg_op);
  else
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  recipients := hs_private.hs_access_user_ids(owner, folder, emails);
  if previous_folder is not null and previous_folder is distinct from folder then
    recipients := recipients || hs_private.hs_access_user_ids(owner, previous_folder, emails);
  end if;

  begin
    perform hs_private.hs_realtime_emit(recipients, doc_topic, payload);
  exception
    when others then
      raise warning 'document realtime notify failed: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$fn$;

revoke all on function hs_private.hs_realtime_notify() from public, anon, authenticated;
grant execute on function hs_private.hs_realtime_notify() to service_role;

drop trigger if exists hs_documents_realtime on public.hs_documents;
create trigger hs_documents_realtime
  after insert or update on public.hs_documents
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_documents_realtime_delete on public.hs_documents;
create trigger hs_documents_realtime_delete
  before delete on public.hs_documents
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_doc_folders_realtime on public.hs_doc_folders;
create trigger hs_doc_folders_realtime
  after insert or update on public.hs_doc_folders
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_doc_folders_realtime_delete on public.hs_doc_folders;
create trigger hs_doc_folders_realtime_delete
  before delete on public.hs_doc_folders
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_files_realtime on public.hs_files;
create trigger hs_files_realtime
  after insert or update on public.hs_files
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_files_realtime_delete on public.hs_files;
create trigger hs_files_realtime_delete
  before delete on public.hs_files
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_document_shares_realtime on public.hs_document_shares;
create trigger hs_document_shares_realtime
  after insert or update or delete on public.hs_document_shares
  for each row execute function hs_private.hs_realtime_notify();

drop trigger if exists hs_folder_shares_realtime on public.hs_folder_shares;
create trigger hs_folder_shares_realtime
  after insert or update or delete on public.hs_folder_shares
  for each row execute function hs_private.hs_realtime_notify();

-- realtime.messages already has RLS. Do not ALTER it (the migration role is
-- not the owner, and that statement aborts the transaction).
drop policy if exists "hs_doc_realtime_select" on realtime.messages;
create policy "hs_doc_realtime_select"
on realtime.messages
for select
to authenticated
using (
  (select realtime.messages.topic) = (select realtime.topic())
  and (
    (
      (select realtime.messages.extension) in ('broadcast', 'presence')
      and hs_private.hs_can_subscribe_document((select realtime.topic()))
    )
    or (
      (select realtime.messages.extension) = 'broadcast'
      and (select realtime.topic()) = 'inbox:' || (select auth.uid())::text
    )
  )
);

drop policy if exists "hs_doc_realtime_presence_insert" on realtime.messages;
create policy "hs_doc_realtime_presence_insert"
on realtime.messages
for insert
to authenticated
with check (
  (select realtime.messages.topic) = (select realtime.topic())
  and (select realtime.messages.extension) = 'presence'
  and hs_private.hs_can_subscribe_document((select realtime.topic()))
);

drop policy if exists "hs_doc_realtime_broadcast_insert" on realtime.messages;
create policy "hs_doc_realtime_broadcast_insert"
on realtime.messages
for insert
to authenticated
with check (
  (select realtime.messages.topic) = (select realtime.topic())
  and (select realtime.messages.extension) = 'broadcast'
  and hs_private.hs_can_subscribe_document((select realtime.topic()))
  and (
    (select public.hs_is_manager())
    or exists (
      select 1
      from public.hs_documents d
      where d.id = hs_private.hs_topic_document_id((select realtime.topic()))
        and (
          d.owner_id = (select auth.uid())
          or exists (
            select 1
            from public.hs_document_shares s
            where s.document_id = d.id
              and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
              and s.permission = 'edit'
          )
          or (
            d.folder_id is not null
            and hs_private.hs_folder_permission(d.folder_id) = 'edit'
          )
        )
    )
  )
);
