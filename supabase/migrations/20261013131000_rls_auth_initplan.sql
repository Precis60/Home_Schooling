-- Cache auth.jwt() once per statement in the policies this change owns.
-- The linter wants (select auth.jwt()), not auth.jwt() evaluated per row.

drop policy if exists "hs_folder_shares read" on public.hs_folder_shares;
create policy "hs_folder_shares read" on public.hs_folder_shares
  for select
  to authenticated
  using (
    (select public.hs_is_manager())
    or shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    or hs_private.hs_owns_folder(folder_id)
  );

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

drop policy if exists "hs_document_shares read" on public.hs_document_shares;
create policy "hs_document_shares read" on public.hs_document_shares
  for select
  to authenticated
  using (
    (select public.hs_is_manager())
    or shared_with_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
    or hs_private.hs_owns_document(document_id)
  );
