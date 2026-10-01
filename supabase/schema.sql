-- Home Schooling & Sports Training Hub - dedicated Supabase schema
-- Run this once in a NEW project's SQL editor (Dashboard > SQL Editor).
-- This project must be separate from any other business's Supabase project.
--
-- Authorization model:
--   manager  - full access to hs_spaces and hs_tasks
--   student  - only the row whose id (spaces) or data.assignee (tasks)
--              equals the JWT email
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
