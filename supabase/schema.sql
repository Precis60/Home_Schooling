-- Home Schooling & Sports Training Hub - dedicated Supabase schema
-- Run this once in a NEW project's SQL editor (Dashboard > SQL Editor).
-- This project must be separate from any other business's Supabase project.
--
-- Authorization model:
--   manager  - full access to hs_spaces, hs_tasks, documents, and lesson links
--   student  - only the row whose id (spaces) or data.assignee (tasks)
--              equals the JWT email. Documents: their own rows, plus
--              documents a manager has shared with that email.
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
    and owner_email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
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
        and s.shared_with_email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    )
  );

drop policy if exists "hs_documents student insert" on public.hs_documents;
create policy "hs_documents student insert" on public.hs_documents
  for insert
  to authenticated
  with check (
    owner_id = (select auth.uid())
    and owner_email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
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
        and s.shared_with_email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
        and s.permission = 'edit'
    )
  )
  with check (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.hs_document_shares s
      where s.document_id = hs_documents.id
        and s.shared_with_email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
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
    or shared_with_email = lower(coalesce((select auth.jwt() ->> 'email'), ''))
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
