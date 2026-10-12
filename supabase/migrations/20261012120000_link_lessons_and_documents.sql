-- Link calendar lessons (hs_tasks) to documents. Many-to-many.
-- Apply only to the Home Schooling project (ref rkmrzflpgrdqnfdexens).
-- Deleting a lesson or a document deletes the link and leaves the other side.
-- A row is visible, and can be created or removed, only when the caller can
-- already read both the lesson and the document under their existing policies.
-- Linking does not grant access. Roles come from app_metadata, never user_metadata.

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
