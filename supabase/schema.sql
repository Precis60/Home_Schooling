-- Home Schooling & Sports Training Hub - dedicated Supabase schema
-- Run this once in a NEW project's SQL editor (Dashboard > SQL Editor).
-- This project must be separate from any other business's Supabase project.
--
-- Authorization model:
--   manager  - full access to hs_spaces, hs_tasks, documents, files, and lesson links
--   student  - only the row whose id (spaces) or data.assignee (tasks)
--              equals the JWT email. Documents and files: their own rows,
--              documents a manager has shared with that email, and anything
--              inside a folder shared with that email (view or edit).
--              Lesson links: only when they can already read both sides.
-- The role claim is auth.jwt() -> app_metadata ->> role.
-- Do not authorize with user_metadata. Users can edit that claim.

-- ---------------------------------------------------------------------------
-- hs_spaces: one row per student, id = the student's login email.
-- data = that student's array of spaces/folders/lists.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_spaces (
  id text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.hs_spaces enable row level security;

create policy "hs_spaces manager all" on public.hs_spaces
  for all
  to authenticated
  using (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager')
  with check (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager');

create policy "hs_spaces student own" on public.hs_spaces
  for all
  to authenticated
  using (
    (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'student')
    and (id = (auth.jwt() ->> 'email'::text))
  )
  with check (
    (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'student')
    and (id = (auth.jwt() ->> 'email'::text))
  );

-- ---------------------------------------------------------------------------
-- hs_tasks: one row per task. data.assignee must equal the assigned
-- student's login email (RLS depends on this).
-- ---------------------------------------------------------------------------
create table if not exists public.hs_tasks (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.hs_tasks enable row level security;

create policy "hs_tasks manager all" on public.hs_tasks
  for all
  to authenticated
  using (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager')
  with check (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'manager');

create policy "hs_tasks student own" on public.hs_tasks
  for all
  to authenticated
  using (
    (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'student')
    and ((data ->> 'assignee'::text) = (auth.jwt() ->> 'email'::text))
  )
  with check (
    (((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'student')
    and ((data ->> 'assignee'::text) = (auth.jwt() ->> 'email'::text))
  );

-- ---------------------------------------------------------------------------
-- hs_users: single row (id = 'main') directory of student name/email/role.
-- Only written by the manage-student-account Edge Function (service role);
-- readable by any signed-in user so a fresh login can resolve its own role.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_users (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.hs_users enable row level security;

create policy "hs_users_select_authenticated" on public.hs_users
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Fictional sample data for a brand-new project only.
-- Skipped automatically when hs_spaces or hs_tasks already have rows, so
-- re-running this file cannot overwrite or append to a live account.
-- These addresses and names are placeholders. Do not replace them with
-- real family names or emails in this repository.
-- ---------------------------------------------------------------------------
insert into public.hs_spaces (id, data)
select seed.id, seed.data
from (values
  ('student.one@example.com', '[
    {"id":"home-school-student-one","name":"Home Schooling","folders":[
      {"id":"math-student-one","name":"Mathematics","folders":[],"lists":[{"id":"list-math-student-one","name":"Sample mathematics"}]},
      {"id":"science-student-one","name":"Science","folders":[],"lists":[{"id":"list-science-student-one","name":"Sample science"}]},
      {"id":"english-student-one","name":"English","folders":[],"lists":[]}
    ]},
    {"id":"sporting-student-one","name":"Alex Example''s Activities","folders":[
      {"id":"sport-student-one","name":"Physical Education","folders":[],"lists":[
        {"id":"list-morning-student-one","name":"Morning exercises"},
        {"id":"list-afternoon-student-one","name":"Sample afternoon sport"}
      ]}
    ]}
  ]'::jsonb),
  ('student.two@example.com', '[
    {"id":"home-school-student-two","name":"Home Schooling","folders":[
      {"id":"math-student-two","name":"Mathematics","folders":[],"lists":[{"id":"list-math-student-two","name":"Sample mathematics"}]},
      {"id":"english-student-two","name":"English","folders":[],"lists":[]}
    ]},
    {"id":"sporting-student-two","name":"Sam Example''s Activities","folders":[
      {"id":"sport-student-two","name":"Physical Education","folders":[],"lists":[]}
    ]}
  ]'::jsonb)
) as seed(id, data)
where not exists (select 1 from public.hs_spaces);

insert into public.hs_tasks (id, data)
select seed.id, seed.data
from (values
  ('sample-task-math-student-two', '{"id":"sample-task-math-student-two","desc":"Example task for a new install.","notes":"","title":"Sample mathematics worksheet","listId":"list-math-student-two","status":"Planned","dueDate":"2026-08-17","dueTime":"12:00","assignee":"student.two@example.com","priority":"Medium","startDate":"2026-08-17","startTime":"10:00"}'::jsonb),
  ('sample-task-sport-student-one', '{"id":"sample-task-sport-student-one","desc":"Example activity for a new install.","notes":"","title":"Sample afternoon sport","listId":"list-afternoon-student-one","status":"Planned","dueDate":"2026-08-17","dueTime":"14:00","assignee":"student.one@example.com","priority":"Medium","startDate":"2026-08-17","startTime":"13:00"}'::jsonb),
  ('sample-task-science-student-one', '{"id":"sample-task-science-student-one","desc":"Example task for a new install.","notes":"","title":"Sample science lesson","listId":"list-science-student-one","status":"Planned","dueDate":"2026-08-17","dueTime":"16:00","assignee":"student.one@example.com","priority":"Low","startDate":"2026-08-17","startTime":"15:00"}'::jsonb)
) as seed(id, data)
where not exists (select 1 from public.hs_tasks);

-- ---------------------------------------------------------------------------
-- Documents, nested folders, manager shares, and private image storage.
-- Kept in step with supabase/migrations/20261012000000_create_documents_schema.sql.
-- ---------------------------------------------------------------------------

-- Documents, folders, and private image storage for the Home Schooling hub.
-- Apply only to the Home Schooling project (ref rkmrzflpgrdqnfdexens).
-- Roles come from app_metadata, never user_metadata.

create or replace function public.hs_is_manager()
returns boolean
language sql
stable
security invoker
set search_path = public
as $fn$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager';
$fn$;

revoke all on function public.hs_is_manager() from public, anon;
grant execute on function public.hs_is_manager() to authenticated;

-- Helpers that bypass row security stay out of the Data API. public is exposed;
-- hs_private is not.
create schema if not exists hs_private;
revoke all on schema hs_private from public, anon;
grant usage on schema hs_private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Folders. parent_id nests folders. owner_id is the auth user who owns them.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_doc_folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_email text not null,
  parent_id uuid references public.hs_doc_folders (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hs_doc_folders_name_len check (char_length(name) between 1 and 200),
  constraint hs_doc_folders_email_shape check (owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);

create index if not exists hs_doc_folders_owner_idx on public.hs_doc_folders (owner_id);
create index if not exists hs_doc_folders_parent_idx on public.hs_doc_folders (parent_id);
create index if not exists hs_doc_folders_owner_email_idx on public.hs_doc_folders (owner_email);

create or replace function hs_private.hs_doc_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  parent_owner uuid;
  walk uuid;
  depth integer := 0;
begin
  new.name := btrim(new.name);
  if new.name is null or char_length(new.name) < 1 or char_length(new.name) > 200 then
    raise exception 'folder name is required';
  end if;
  new.owner_email := lower(btrim(new.owner_email));
  if new.owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'folder owner email is invalid';
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if auth.uid() is not null and not public.hs_is_manager() then
      if new.owner_id is distinct from old.owner_id or new.owner_email is distinct from old.owner_email then
        raise exception 'folder owner cannot be changed';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and not public.hs_is_manager() then
    if new.owner_id is distinct from auth.uid()
       or new.owner_email is distinct from lower(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'students can only create their own folders';
    end if;
  end if;
  if new.parent_id is not null then
    if new.id is not null and new.parent_id = new.id then
      raise exception 'folder cannot be its own parent';
    end if;
    select f.owner_id into parent_owner
    from public.hs_doc_folders f
    where f.id = new.parent_id;
    if parent_owner is null or parent_owner is distinct from new.owner_id then
      raise exception 'parent folder must belong to the same owner';
    end if;
    walk := new.parent_id;
    while walk is not null and depth < 9 loop
      if new.id is not null and walk = new.id then
        raise exception 'folder cycle';
      end if;
      depth := depth + 1;
      select f.parent_id into walk from public.hs_doc_folders f where f.id = walk;
    end loop;
    if depth >= 8 then
      raise exception 'folders can only be nested 8 levels deep';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists hs_doc_folders_guard on public.hs_doc_folders;
create trigger hs_doc_folders_guard
  before insert or update on public.hs_doc_folders
  for each row execute function hs_private.hs_doc_folders_guard();

alter table public.hs_doc_folders enable row level security;

drop policy if exists "hs_doc_folders manager all" on public.hs_doc_folders;
create policy "hs_doc_folders manager all" on public.hs_doc_folders
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

drop policy if exists "hs_doc_folders student own" on public.hs_doc_folders;
create policy "hs_doc_folders student own" on public.hs_doc_folders
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and owner_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

-- ---------------------------------------------------------------------------
-- Documents. body_html is sanitized again in the browser before display.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_email text not null,
  folder_id uuid references public.hs_doc_folders (id) on delete cascade,
  title text not null,
  body_html text not null default '<p></p>',
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hs_documents_title_len check (char_length(title) between 1 and 200),
  constraint hs_documents_body_len check (char_length(body_html) between 1 and 1000000),
  constraint hs_documents_email_shape check (owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);

create index if not exists hs_documents_owner_idx on public.hs_documents (owner_id);
create index if not exists hs_documents_folder_idx on public.hs_documents (folder_id);
create index if not exists hs_documents_owner_email_idx on public.hs_documents (owner_email);
create index if not exists hs_documents_title_idx on public.hs_documents (title);

create table if not exists public.hs_document_shares (
  document_id uuid not null references public.hs_documents (id) on delete cascade,
  shared_with_email text not null,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (document_id, shared_with_email),
  constraint hs_document_shares_permission check (permission in ('view', 'edit')),
  constraint hs_document_shares_email_shape check (shared_with_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);

create index if not exists hs_document_shares_email_idx on public.hs_document_shares (shared_with_email);

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
  if auth.uid() is null or public.hs_is_manager() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is distinct from auth.uid()
       or new.owner_email is distinct from lower(coalesce(auth.jwt() ->> 'email', '')) then
      raise exception 'students can only create their own documents';
    end if;
    return new;
  end if;
  if old.owner_id = auth.uid() then
    if new.owner_id is distinct from old.owner_id or new.owner_email is distinct from old.owner_email then
      raise exception 'owners cannot be reassigned';
    end if;
    return new;
  end if;
  if exists (
    select 1 from public.hs_document_shares s
    where s.document_id = old.id
      and s.shared_with_email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and s.permission = 'edit'
  ) then
    if new.owner_id is distinct from old.owner_id
       or new.owner_email is distinct from old.owner_email
       or new.folder_id is distinct from old.folder_id then
      raise exception 'shared editors cannot move or reassign documents';
    end if;
    return new;
  end if;
  raise exception 'not allowed to edit this document';
end;
$fn$;

drop trigger if exists hs_documents_guard on public.hs_documents;
create trigger hs_documents_guard
  before insert or update on public.hs_documents
  for each row execute function hs_private.hs_documents_guard();

create or replace function hs_private.hs_document_shares_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  owner_email text;
begin
  new.shared_with_email := lower(btrim(new.shared_with_email));
  if new.permission not in ('view', 'edit') then
    raise exception 'share permission must be view or edit';
  end if;
  if new.shared_with_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'share email is invalid';
  end if;
  select d.owner_email into owner_email
  from public.hs_documents d
  where d.id = new.document_id;
  if owner_email is not null and owner_email = new.shared_with_email then
    raise exception 'a document cannot be shared with its owner';
  end if;
  if auth.uid() is not null and not public.hs_is_manager() then
    raise exception 'only a manager can share documents';
  end if;
  return new;
end;
$fn$;

drop trigger if exists hs_document_shares_guard on public.hs_document_shares;
create trigger hs_document_shares_guard
  before insert or update on public.hs_document_shares
  for each row execute function hs_private.hs_document_shares_guard();

alter table public.hs_documents enable row level security;
alter table public.hs_document_shares enable row level security;

drop policy if exists "hs_documents manager all" on public.hs_documents;
create policy "hs_documents manager all" on public.hs_documents
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

drop policy if exists "hs_documents student read" on public.hs_documents;
create policy "hs_documents student read" on public.hs_documents
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
  );

drop policy if exists "hs_documents student insert" on public.hs_documents;
create policy "hs_documents student insert" on public.hs_documents
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and owner_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );

drop policy if exists "hs_documents student update" on public.hs_documents;
create policy "hs_documents student update" on public.hs_documents
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and s.permission = 'edit'
    )
  )
  with check (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and s.permission = 'edit'
    )
  );

drop policy if exists "hs_documents student delete" on public.hs_documents;
create policy "hs_documents student delete" on public.hs_documents
  for delete
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "hs_document_shares manager write" on public.hs_document_shares;
create policy "hs_document_shares manager write" on public.hs_document_shares
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

-- Security definer so the share policy can see ownership without reading
-- hs_documents through RLS (that policy reads shares, which would recurse).
create or replace function hs_private.hs_owns_document(doc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.hs_documents d
    where d.id = doc_id
      and d.owner_id = auth.uid()
  );
$fn$;

revoke all on function hs_private.hs_owns_document(uuid) from public, anon;
grant execute on function hs_private.hs_owns_document(uuid) to authenticated;

drop policy if exists "hs_document_shares read" on public.hs_document_shares;
create policy "hs_document_shares read" on public.hs_document_shares
  for select
  to authenticated
  using (
    (select public.hs_is_manager())
    or shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    or hs_private.hs_owns_document(document_id)
  );

revoke all on public.hs_doc_folders from public, anon;
revoke all on public.hs_documents from public, anon;
revoke all on public.hs_document_shares from public, anon;
grant select, insert, update, delete on public.hs_doc_folders to authenticated;
grant select, insert, update, delete on public.hs_documents to authenticated;
grant select, insert, update, delete on public.hs_document_shares to authenticated;

revoke all on function hs_private.hs_doc_folders_guard() from public, anon, authenticated;
revoke all on function hs_private.hs_documents_guard() from public, anon, authenticated;
revoke all on function hs_private.hs_document_shares_guard() from public, anon, authenticated;
grant execute on function hs_private.hs_doc_folders_guard() to service_role;
grant execute on function hs_private.hs_documents_guard() to service_role;
grant execute on function hs_private.hs_document_shares_guard() to service_role;

-- ---------------------------------------------------------------------------
-- Private images. Object name is {owner_email}/{document_id}/{uuid}.{ext}.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hs-document-images',
  'hs-document-images',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function hs_private.hs_storage_image_allowed(object_name text, need_edit boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  parts text[];
  doc_id uuid;
  doc_owner uuid;
  doc_email text;
  caller_email text;
begin
  if auth.uid() is null then
    return false;
  end if;
  parts := storage.foldername(object_name);
  if cardinality(parts) <> 3 then
    return false;
  end if;
  if parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$' then
    return false;
  end if;
  begin
    doc_id := parts[2]::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;
  select d.owner_id, d.owner_email into doc_owner, doc_email
  from public.hs_documents d
  where d.id = doc_id;
  if doc_owner is null or doc_email is distinct from lower(parts[1]) then
    return false;
  end if;
  if public.hs_is_manager() or doc_owner = auth.uid() then
    return true;
  end if;
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if need_edit then
    return exists (
      select 1 from public.hs_document_shares s
      where s.document_id = doc_id
        and s.shared_with_email = caller_email
        and s.permission = 'edit'
    );
  end if;
  return exists (
    select 1 from public.hs_document_shares s
    where s.document_id = doc_id
      and s.shared_with_email = caller_email
  );
end;
$fn$;

revoke all on function hs_private.hs_storage_image_allowed(text, boolean) from public, anon;
grant execute on function hs_private.hs_storage_image_allowed(text, boolean) to authenticated;

drop policy if exists "hs_document_images select" on storage.objects;
create policy "hs_document_images select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hs-document-images'
    and hs_private.hs_storage_image_allowed(name, false)
  );

drop policy if exists "hs_document_images insert" on storage.objects;
create policy "hs_document_images insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hs-document-images'
    and hs_private.hs_storage_image_allowed(name, true)
  );

drop policy if exists "hs_document_images update" on storage.objects;
create policy "hs_document_images update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'hs-document-images'
    and hs_private.hs_storage_image_allowed(name, true)
  )
  with check (
    bucket_id = 'hs-document-images'
    and hs_private.hs_storage_image_allowed(name, true)
  );

drop policy if exists "hs_document_images delete" on storage.objects;
create policy "hs_document_images delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hs-document-images'
    and hs_private.hs_storage_image_allowed(name, true)
  );

-- Link each student login to the private directory so a manager can file
-- documents under that student. Does not write names or emails into git.
insert into public.hs_users (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

update public.hs_users as directory
set data = directory.data || coalesce((
  select jsonb_object_agg(
    lower(u.email),
    coalesce(directory.data -> lower(u.email), '{}'::jsonb) || jsonb_build_object(
      'auth_id', u.id::text,
      'name', coalesce(directory.data -> lower(u.email) ->> 'name', 'Student'),
      'role', 'student'
    )
  )
  from auth.users u
  where coalesce(u.raw_app_meta_data ->> 'role', '') = 'student'
    and u.email is not null
), '{}'::jsonb)
where directory.id = 'main';

-- ---------------------------------------------------------------------------
-- hs_lesson_documents: many-to-many between calendar lessons and documents.
-- Deleting either side deletes the link only. A caller can see or change a
-- link only when they can already read both the lesson and the document.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_lesson_documents (
  task_id text not null references public.hs_tasks (id) on delete cascade,
  document_id uuid not null references public.hs_documents (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, document_id)
);

create index if not exists hs_lesson_documents_document_idx
  on public.hs_lesson_documents (document_id);

alter table public.hs_lesson_documents enable row level security;

drop policy if exists "hs_lesson_documents manager all" on public.hs_lesson_documents;
create policy "hs_lesson_documents manager all" on public.hs_lesson_documents
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

drop policy if exists "hs_lesson_documents select visible" on public.hs_lesson_documents;
create policy "hs_lesson_documents select visible" on public.hs_lesson_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.hs_tasks as lesson
      where lesson.id = hs_lesson_documents.task_id
    )
    and exists (
      select 1 from public.hs_documents as doc
      where doc.id = hs_lesson_documents.document_id
    )
  );

drop policy if exists "hs_lesson_documents insert visible" on public.hs_lesson_documents;
create policy "hs_lesson_documents insert visible" on public.hs_lesson_documents
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.hs_tasks as lesson
      where lesson.id = hs_lesson_documents.task_id
    )
    and exists (
      select 1 from public.hs_documents as doc
      where doc.id = hs_lesson_documents.document_id
    )
  );

drop policy if exists "hs_lesson_documents delete visible" on public.hs_lesson_documents;
create policy "hs_lesson_documents delete visible" on public.hs_lesson_documents
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.hs_tasks as lesson
      where lesson.id = hs_lesson_documents.task_id
    )
    and exists (
      select 1 from public.hs_documents as doc
      where doc.id = hs_lesson_documents.document_id
    )
  );

revoke all on table public.hs_lesson_documents from public, anon;
grant select, insert, delete on table public.hs_lesson_documents to authenticated;
revoke update, truncate, trigger, references on table public.hs_lesson_documents from authenticated;

-- ---------------------------------------------------------------------------
-- Shared folders, private file storage, and lesson-file links.
-- These statements replace the folder, document, and image policies above.
-- Kept in step with supabase/migrations/20261013120000_shared_folders_and_files.sql.
-- ---------------------------------------------------------------------------

-- Shared folders and private file storage for the Home Schooling hub.
-- Apply only to the Home Schooling project (ref rkmrzflpgrdqnfdexens).
-- Roles come from app_metadata, never user_metadata.
--
-- A folder share grants view or edit on that folder and everything inside it
-- (subfolders, documents, and files). Managers keep full access. Students still
-- see only their own rows, documents shared with them directly, and rows that
-- sit inside a folder shared with them. Linking a file to a lesson does not
-- grant access to the file.

-- ---------------------------------------------------------------------------
-- Folder shares. Only a manager can write them.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_folder_shares (
  folder_id uuid not null references public.hs_doc_folders (id) on delete cascade,
  shared_with_email text not null,
  permission text not null,
  created_at timestamptz not null default now(),
  primary key (folder_id, shared_with_email),
  constraint hs_folder_shares_permission check (permission in ('view', 'edit')),
  constraint hs_folder_shares_email_shape check (shared_with_email ~ '^[^[:space:]@]+@[^[:space:]@]+$')
);

create index if not exists hs_folder_shares_email_idx
  on public.hs_folder_shares (shared_with_email);

create or replace function hs_private.hs_folder_permission(target uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  caller uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  current_id uuid := target;
  parent_id uuid;
  row_owner uuid;
  share_perm text;
  best text := null;
  depth integer := 0;
begin
  if caller is null or target is null then
    return null;
  end if;
  if public.hs_is_manager() then
    return 'edit';
  end if;
  while current_id is not null and depth < 12 loop
    select f.owner_id, f.parent_id into row_owner, parent_id
    from public.hs_doc_folders f
    where f.id = current_id;
    if not found then
      return best;
    end if;
    if row_owner = caller then
      return 'edit';
    end if;
    select s.permission into share_perm
    from public.hs_folder_shares s
    where s.folder_id = current_id
      and s.shared_with_email = caller_email;
    if share_perm = 'edit' then
      return 'edit';
    end if;
    if share_perm = 'view' and best is null then
      best := 'view';
    end if;
    current_id := parent_id;
    depth := depth + 1;
  end loop;
  return best;
end;
$fn$;

revoke all on function hs_private.hs_folder_permission(uuid) from public, anon;
grant execute on function hs_private.hs_folder_permission(uuid) to authenticated;

create or replace function hs_private.hs_owns_folder(folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1
    from public.hs_doc_folders f
    where f.id = hs_owns_folder.folder_id
      and f.owner_id = auth.uid()
  );
$fn$;

revoke all on function hs_private.hs_owns_folder(uuid) from public, anon;
grant execute on function hs_private.hs_owns_folder(uuid) to authenticated;

create or replace function hs_private.hs_can_insert_folder(new_owner uuid, new_email text, new_parent uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  parent public.hs_doc_folders%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.hs_is_manager() then
    return true;
  end if;
  if new_owner = auth.uid()
     and new_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    if new_parent is null then
      return true;
    end if;
    return hs_private.hs_folder_permission(new_parent) = 'edit';
  end if;
  if new_parent is null then
    return false;
  end if;
  if hs_private.hs_folder_permission(new_parent) is distinct from 'edit' then
    return false;
  end if;
  select * into parent from public.hs_doc_folders where id = new_parent;
  if not found then
    return false;
  end if;
  return parent.owner_id = new_owner and parent.owner_email = new_email;
end;
$fn$;

revoke all on function hs_private.hs_can_insert_folder(uuid, text, uuid) from public, anon;
grant execute on function hs_private.hs_can_insert_folder(uuid, text, uuid) to authenticated;

create or replace function hs_private.hs_doc_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  parent_owner uuid;
  walk uuid;
  depth integer := 0;
begin
  new.name := btrim(new.name);
  if new.name is null or char_length(new.name) < 1 or char_length(new.name) > 200 then
    raise exception 'folder name is required';
  end if;
  new.owner_email := lower(btrim(new.owner_email));
  if new.owner_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'folder owner email is invalid';
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if auth.uid() is not null and not public.hs_is_manager() then
      if new.owner_id is distinct from old.owner_id or new.owner_email is distinct from old.owner_email then
        raise exception 'folder owner cannot be changed';
      end if;
      if old.owner_id is distinct from auth.uid() then
        if hs_private.hs_folder_permission(old.id) is distinct from 'edit' then
          raise exception 'not allowed to change this folder';
        end if;
        if new.parent_id is distinct from old.parent_id
           and (new.parent_id is null or hs_private.hs_folder_permission(new.parent_id) is distinct from 'edit') then
          raise exception 'not allowed to move this folder';
        end if;
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and not public.hs_is_manager() then
    if not hs_private.hs_can_insert_folder(new.owner_id, new.owner_email, new.parent_id) then
      raise exception 'students can only create their own folders';
    end if;
  end if;
  if new.parent_id is not null then
    if new.id is not null and new.parent_id = new.id then
      raise exception 'folder cannot be its own parent';
    end if;
    select f.owner_id into parent_owner
    from public.hs_doc_folders f
    where f.id = new.parent_id;
    if parent_owner is null or parent_owner is distinct from new.owner_id then
      raise exception 'parent folder must belong to the same owner';
    end if;
    walk := new.parent_id;
    while walk is not null and depth < 9 loop
      if new.id is not null and walk = new.id then
        raise exception 'folder cycle';
      end if;
      depth := depth + 1;
      select f.parent_id into walk from public.hs_doc_folders f where f.id = walk;
    end loop;
    if depth >= 8 then
      raise exception 'folders can only be nested 8 levels deep';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop policy if exists "hs_doc_folders student own" on public.hs_doc_folders;
drop policy if exists "hs_doc_folders student read" on public.hs_doc_folders;
drop policy if exists "hs_doc_folders student insert" on public.hs_doc_folders;
drop policy if exists "hs_doc_folders student update" on public.hs_doc_folders;
drop policy if exists "hs_doc_folders student delete" on public.hs_doc_folders;

create policy "hs_doc_folders student read" on public.hs_doc_folders
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or hs_private.hs_folder_permission(id) is not null
  );

create policy "hs_doc_folders student insert" on public.hs_doc_folders
  for insert
  to authenticated
  with check (hs_private.hs_can_insert_folder(owner_id, owner_email, parent_id));

create policy "hs_doc_folders student update" on public.hs_doc_folders
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or hs_private.hs_folder_permission(id) = 'edit'
  )
  with check (
    owner_id = (select auth.uid())
    or hs_private.hs_folder_permission(id) = 'edit'
  );

create policy "hs_doc_folders student delete" on public.hs_doc_folders
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or hs_private.hs_folder_permission(id) = 'edit'
  );

create or replace function hs_private.hs_folder_shares_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  owner_email text;
begin
  new.shared_with_email := lower(btrim(new.shared_with_email));
  if new.permission not in ('view', 'edit') then
    raise exception 'share permission must be view or edit';
  end if;
  if new.shared_with_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'share email is invalid';
  end if;
  select f.owner_email into owner_email
  from public.hs_doc_folders f
  where f.id = new.folder_id;
  if owner_email is not null and owner_email = new.shared_with_email then
    raise exception 'a folder cannot be shared with its owner';
  end if;
  if auth.uid() is not null and not public.hs_is_manager() then
    raise exception 'only a manager can share folders';
  end if;
  return new;
end;
$fn$;

drop trigger if exists hs_folder_shares_guard on public.hs_folder_shares;
create trigger hs_folder_shares_guard
  before insert or update on public.hs_folder_shares
  for each row execute function hs_private.hs_folder_shares_guard();

alter table public.hs_folder_shares enable row level security;

drop policy if exists "hs_folder_shares manager write" on public.hs_folder_shares;
create policy "hs_folder_shares manager write" on public.hs_folder_shares
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

drop policy if exists "hs_folder_shares read" on public.hs_folder_shares;
create policy "hs_folder_shares read" on public.hs_folder_shares
  for select
  to authenticated
  using (
    (select public.hs_is_manager())
    or shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    or hs_private.hs_owns_folder(folder_id)
  );

revoke all on public.hs_folder_shares from public, anon;
grant select, insert, update, delete on public.hs_folder_shares to authenticated;
revoke truncate on public.hs_folder_shares from authenticated, anon, public;

revoke all on function hs_private.hs_folder_shares_guard() from public, anon, authenticated;
grant execute on function hs_private.hs_folder_shares_guard() to service_role;

-- ---------------------------------------------------------------------------
-- Documents inherit access from a shared folder. Direct shares still work.
-- ---------------------------------------------------------------------------
create or replace function hs_private.hs_can_insert_document(new_owner uuid, new_email text, new_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  folder public.hs_doc_folders%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.hs_is_manager() then
    return true;
  end if;
  if new_owner = auth.uid()
     and new_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    if new_folder is null then
      return true;
    end if;
    return hs_private.hs_folder_permission(new_folder) = 'edit';
  end if;
  if new_folder is null then
    return false;
  end if;
  if hs_private.hs_folder_permission(new_folder) is distinct from 'edit' then
    return false;
  end if;
  select * into folder from public.hs_doc_folders where id = new_folder;
  if not found then
    return false;
  end if;
  return folder.owner_id = new_owner and folder.owner_email = new_email;
end;
$fn$;

revoke all on function hs_private.hs_can_insert_document(uuid, text, uuid) from public, anon;
grant execute on function hs_private.hs_can_insert_document(uuid, text, uuid) to authenticated;

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

drop policy if exists "hs_documents student read" on public.hs_documents;
create policy "hs_documents student read" on public.hs_documents
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    )
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) is not null
    )
  );

drop policy if exists "hs_documents student insert" on public.hs_documents;
create policy "hs_documents student insert" on public.hs_documents
  for insert
  to authenticated
  with check (hs_private.hs_can_insert_document(owner_id, owner_email, folder_id));

drop policy if exists "hs_documents student update" on public.hs_documents;
create policy "hs_documents student update" on public.hs_documents
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and s.permission = 'edit'
    )
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) = 'edit'
    )
  )
  with check (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
        and s.permission = 'edit'
    )
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) = 'edit'
    )
  );

drop policy if exists "hs_documents student delete" on public.hs_documents;
create policy "hs_documents student delete" on public.hs_documents
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) = 'edit'
    )
  );

-- Document images follow the document, including access inherited from a folder.
create or replace function hs_private.hs_storage_image_allowed(object_name text, need_edit boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  parts text[];
  doc_id uuid;
  doc_owner uuid;
  doc_email text;
  doc_folder uuid;
  caller_email text;
  perm text;
begin
  if auth.uid() is null then
    return false;
  end if;
  parts := storage.foldername(object_name);
  if cardinality(parts) <> 2 then
    return false;
  end if;
  if storage.filename(object_name) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$' then
    return false;
  end if;
  begin
    doc_id := parts[2]::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;
  select d.owner_id, d.owner_email, d.folder_id into doc_owner, doc_email, doc_folder
  from public.hs_documents d
  where d.id = doc_id;
  if doc_owner is null or doc_email is distinct from lower(parts[1]) then
    return false;
  end if;
  if public.hs_is_manager() or doc_owner = auth.uid() then
    return true;
  end if;
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if need_edit then
    if exists (
      select 1 from public.hs_document_shares s
      where s.document_id = doc_id
        and s.shared_with_email = caller_email
        and s.permission = 'edit'
    ) then
      return true;
    end if;
  elsif exists (
    select 1 from public.hs_document_shares s
    where s.document_id = doc_id
      and s.shared_with_email = caller_email
  ) then
    return true;
  end if;
  if doc_folder is null then
    return false;
  end if;
  perm := hs_private.hs_folder_permission(doc_folder);
  if need_edit then
    return perm = 'edit';
  end if;
  return perm is not null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Uploaded files. The storage object name is the file id. Nothing is public.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_email text not null,
  folder_id uuid references public.hs_doc_folders (id) on delete cascade,
  name text not null,
  storage_path text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hs_files_name_len check (char_length(name) between 1 and 240),
  constraint hs_files_mime_len check (char_length(mime_type) between 1 and 200),
  constraint hs_files_size check (size_bytes > 0 and size_bytes <= 52428800),
  constraint hs_files_email_shape check (owner_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  constraint hs_files_path_is_id check (storage_path = id::text),
  constraint hs_files_path_unique unique (storage_path)
);

create index if not exists hs_files_owner_idx on public.hs_files (owner_id);
create index if not exists hs_files_folder_idx on public.hs_files (folder_id);
create index if not exists hs_files_owner_email_idx on public.hs_files (owner_email);

create or replace function hs_private.hs_can_insert_file(new_owner uuid, new_email text, new_folder uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  folder public.hs_doc_folders%rowtype;
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.hs_is_manager() then
    return true;
  end if;
  if new_owner = auth.uid()
     and new_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    if new_folder is null then
      return true;
    end if;
    return hs_private.hs_folder_permission(new_folder) = 'edit';
  end if;
  if new_folder is null then
    return false;
  end if;
  if hs_private.hs_folder_permission(new_folder) is distinct from 'edit' then
    return false;
  end if;
  select * into folder from public.hs_doc_folders where id = new_folder;
  if not found then
    return false;
  end if;
  return folder.owner_id = new_owner and folder.owner_email = new_email;
end;
$fn$;

revoke all on function hs_private.hs_can_insert_file(uuid, text, uuid) from public, anon;
grant execute on function hs_private.hs_can_insert_file(uuid, text, uuid) to authenticated;

create or replace function hs_private.hs_files_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  folder_owner uuid;
begin
  new.name := btrim(regexp_replace(new.name, '[[:cntrl:]]', '', 'g'));
  if new.name is null or char_length(new.name) < 1 or char_length(new.name) > 240 then
    raise exception 'file name is required';
  end if;
  new.owner_email := lower(btrim(new.owner_email));
  new.mime_type := lower(btrim(coalesce(new.mime_type, 'application/octet-stream')));
  if new.mime_type = '' then
    new.mime_type := 'application/octet-stream';
  end if;
  if char_length(new.mime_type) > 200 then
    raise exception 'file type name is too long';
  end if;
  if new.size_bytes is null or new.size_bytes <= 0 or new.size_bytes > 52428800 then
    raise exception 'files must be between 1 byte and 50 MB';
  end if;
  if new.storage_path is distinct from new.id::text then
    raise exception 'file storage path must match the file id';
  end if;
  if new.folder_id is not null then
    select f.owner_id into folder_owner
    from public.hs_doc_folders f
    where f.id = new.folder_id;
    if folder_owner is null or folder_owner is distinct from new.owner_id then
      raise exception 'folder must belong to the file owner';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    new.id := old.id;
    new.storage_path := old.storage_path;
    new.size_bytes := old.size_bytes;
    new.mime_type := old.mime_type;
    if auth.uid() is not null and not public.hs_is_manager() then
      if new.owner_id is distinct from old.owner_id or new.owner_email is distinct from old.owner_email then
        raise exception 'file owner cannot be changed';
      end if;
      if old.owner_id = auth.uid() then
        if new.folder_id is not null and hs_private.hs_folder_permission(new.folder_id) is distinct from 'edit' then
          raise exception 'not allowed to move this file there';
        end if;
      else
        if old.folder_id is null or hs_private.hs_folder_permission(old.folder_id) is distinct from 'edit' then
          raise exception 'not allowed to change this file';
        end if;
        if new.folder_id is null or hs_private.hs_folder_permission(new.folder_id) is distinct from 'edit' then
          raise exception 'not allowed to move this file there';
        end if;
      end if;
    end if;
  elsif auth.uid() is not null and not public.hs_is_manager() then
    if not hs_private.hs_can_insert_file(new.owner_id, new.owner_email, new.folder_id) then
      raise exception 'not allowed to add a file here';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists hs_files_guard on public.hs_files;
create trigger hs_files_guard
  before insert or update on public.hs_files
  for each row execute function hs_private.hs_files_guard();

create or replace function hs_private.hs_files_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Supabase blocks direct deletes unless the Storage API sets this flag.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
  where bucket_id = 'hs-files'
    and name = old.storage_path;
  return old;
end;
$fn$;

drop trigger if exists hs_files_cleanup on public.hs_files;
create trigger hs_files_cleanup
  after delete on public.hs_files
  for each row execute function hs_private.hs_files_cleanup();

alter table public.hs_files enable row level security;

drop policy if exists "hs_files manager all" on public.hs_files;
create policy "hs_files manager all" on public.hs_files
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

drop policy if exists "hs_files student read" on public.hs_files;
create policy "hs_files student read" on public.hs_files
  for select
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) is not null
    )
  );

drop policy if exists "hs_files student insert" on public.hs_files;
create policy "hs_files student insert" on public.hs_files
  for insert
  to authenticated
  with check (hs_private.hs_can_insert_file(owner_id, owner_email, folder_id));

drop policy if exists "hs_files student update" on public.hs_files;
create policy "hs_files student update" on public.hs_files
  for update
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) = 'edit'
    )
  )
  with check (
    owner_id = (select auth.uid())
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) = 'edit'
    )
  );

drop policy if exists "hs_files student delete" on public.hs_files;
create policy "hs_files student delete" on public.hs_files
  for delete
  to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      folder_id is not null
      and hs_private.hs_folder_permission(folder_id) = 'edit'
    )
  );

revoke all on public.hs_files from public, anon;
grant select, insert, update, delete on public.hs_files to authenticated;
revoke truncate on public.hs_files from authenticated, anon, public;

revoke all on function hs_private.hs_files_guard() from public, anon, authenticated;
revoke all on function hs_private.hs_files_cleanup() from public, anon, authenticated;
grant execute on function hs_private.hs_files_guard() to service_role;
grant execute on function hs_private.hs_files_cleanup() to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hs-files', 'hs-files', false, 52428800, null)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function hs_private.hs_storage_file_allowed(object_name text, need_edit boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  file_id uuid;
  file_owner uuid;
  file_folder uuid;
  perm text;
begin
  if auth.uid() is null or object_name is null or position('/' in object_name) > 0 then
    return false;
  end if;
  begin
    file_id := object_name::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;
  select f.owner_id, f.folder_id into file_owner, file_folder
  from public.hs_files f
  where f.id = file_id
    and f.storage_path = object_name;
  if file_owner is null then
    return false;
  end if;
  if public.hs_is_manager() or file_owner = auth.uid() then
    return true;
  end if;
  if file_folder is null then
    return false;
  end if;
  perm := hs_private.hs_folder_permission(file_folder);
  if need_edit then
    return perm = 'edit';
  end if;
  return perm is not null;
end;
$fn$;

revoke all on function hs_private.hs_storage_file_allowed(text, boolean) from public, anon;
grant execute on function hs_private.hs_storage_file_allowed(text, boolean) to authenticated;

drop policy if exists "hs_files storage select" on storage.objects;
create policy "hs_files storage select" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'hs-files'
    and hs_private.hs_storage_file_allowed(name, false)
  );

drop policy if exists "hs_files storage insert" on storage.objects;
create policy "hs_files storage insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'hs-files'
    and hs_private.hs_storage_file_allowed(name, true)
  );

drop policy if exists "hs_files storage update" on storage.objects;
create policy "hs_files storage update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'hs-files'
    and hs_private.hs_storage_file_allowed(name, true)
  )
  with check (
    bucket_id = 'hs-files'
    and hs_private.hs_storage_file_allowed(name, true)
  );

drop policy if exists "hs_files storage delete" on storage.objects;
create policy "hs_files storage delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'hs-files'
    and hs_private.hs_storage_file_allowed(name, true)
  );

-- ---------------------------------------------------------------------------
-- Lesson links for uploaded files. Same rule as document links: the caller
-- must already be able to read both the lesson and the file.
-- ---------------------------------------------------------------------------
create table if not exists public.hs_lesson_files (
  task_id text not null references public.hs_tasks (id) on delete cascade,
  file_id uuid not null references public.hs_files (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, file_id)
);

create index if not exists hs_lesson_files_file_idx
  on public.hs_lesson_files (file_id);

alter table public.hs_lesson_files enable row level security;

drop policy if exists "hs_lesson_files manager all" on public.hs_lesson_files;
create policy "hs_lesson_files manager all" on public.hs_lesson_files
  for all
  to authenticated
  using ((select public.hs_is_manager()))
  with check ((select public.hs_is_manager()));

drop policy if exists "hs_lesson_files select visible" on public.hs_lesson_files;
create policy "hs_lesson_files select visible" on public.hs_lesson_files
  for select
  to authenticated
  using (
    exists (
      select 1 from public.hs_tasks as lesson
      where lesson.id = hs_lesson_files.task_id
    )
    and exists (
      select 1 from public.hs_files as file
      where file.id = hs_lesson_files.file_id
    )
  );

drop policy if exists "hs_lesson_files insert visible" on public.hs_lesson_files;
create policy "hs_lesson_files insert visible" on public.hs_lesson_files
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.hs_tasks as lesson
      where lesson.id = hs_lesson_files.task_id
    )
    and exists (
      select 1 from public.hs_files as file
      where file.id = hs_lesson_files.file_id
    )
  );

drop policy if exists "hs_lesson_files delete visible" on public.hs_lesson_files;
create policy "hs_lesson_files delete visible" on public.hs_lesson_files
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.hs_tasks as lesson
      where lesson.id = hs_lesson_files.task_id
    )
    and exists (
      select 1 from public.hs_files as file
      where file.id = hs_lesson_files.file_id
    )
  );

revoke all on table public.hs_lesson_files from public, anon;
grant select, insert, delete on table public.hs_lesson_files to authenticated;
revoke update, truncate, trigger, references on table public.hs_lesson_files from authenticated;

-- Live collaboration. Same statements as supabase/migrations/20261013140000_document_realtime.sql.
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
