-- Default privileges grant truncate and update on new public tables.
-- Lesson links are only selected, inserted, and deleted. Truncate bypasses RLS.
-- Apply only to the Home Schooling project (ref rkmrzflpgrdqnfdexens).

revoke all on table public.hs_lesson_documents from public, anon;
grant select, insert, delete on table public.hs_lesson_documents to authenticated;
revoke update, truncate, trigger, references on table public.hs_lesson_documents from authenticated;
