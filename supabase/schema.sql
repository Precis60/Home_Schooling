-- Home Schooling & Sports Training Hub - dedicated Supabase schema
-- Run this once in your NEW project's SQL editor (Dashboard > SQL Editor).
-- This project must be separate from any other business's Supabase project.

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
-- Seed data - your existing categories and tasks, carried over so nothing
-- is lost when you switch this app to the new project. Skip this section if
-- you'd rather start fresh.
-- ---------------------------------------------------------------------------
insert into public.hs_spaces (id, data) values
('lucas@projects-consultant.com', '[
  {"id":"home-school-lucas","name":"Home Schooling","folders":[
    {"id":"math-lucas","name":"Mathematics","folders":[],"lists":[{"id":"fkvtra7wif9mswtno8v","name":"Khan Academy - Mathematics"}]},
    {"id":"pe-lucas","name":"Physical Education","folders":[],"lists":[]},
    {"id":"science-lucas","name":"Science","folders":[],"lists":[{"id":"2au0643681rmswtno8v","name":"Khan Academy - Science"}]},
    {"id":"business-lucas","name":"Business & Legal","folders":[],"lists":[]},
    {"id":"economics-lucas","name":"Economics & Investment","folders":[],"lists":[]},
    {"id":"english-lucas","name":"English","folders":[],"lists":[]}
  ]},
  {"id":"sporting-lucas","name":"Lucas Anderson''s Activities","folders":[
    {"id":"sporting-pe-lucas","name":"Physical Education","folders":[],"lists":[
      {"id":"2s2l6fpyxdgmswtno8v","name":"Morning Exercises"},
      {"id":"588i0w4b2f6mswtno8v","name":"Midday Sport (UAC Basketball)"}
    ]}
  ]}
]'::jsonb)
on conflict (id) do update set data = excluded.data;

insert into public.hs_spaces (id, data) values
('emily@projects-consultant.com', '[
  {"id":"home-school-emily","name":"Homework","folders":[
    {"id":"math-emily","name":"Mathematics","folders":[],"lists":[{"id":"0ozmk3he2m1imswtno8v","name":"Khan Academy - Mathematics"}]},
    {"id":"pe-emily","name":"Physical Education","folders":[],"lists":[]},
    {"id":"science-emily","name":"Science","folders":[],"lists":[]},
    {"id":"business-emily","name":"Business & Legal","folders":[],"lists":[]},
    {"id":"economics-emily","name":"Economics & Investment","folders":[],"lists":[]},
    {"id":"english-emily","name":"English","folders":[],"lists":[]}
  ]},
  {"id":"sporting-emily","name":"Emily Anderson''s Activities","folders":[
    {"id":"sporting-pe-emily","name":"Physical Education","folders":[],"lists":[]}
  ]}
]'::jsonb)
on conflict (id) do update set data = excluded.data;

insert into public.hs_tasks (id, data) values
('mlgkqm9q8vmswptnr1', '{"id":"mlgkqm9q8vmswptnr1","desc":"","notes":"","title":"T03W06H01: Khan Academy - Mathematics!","listId":"0ozmk3he2m1imswtno8v","status":"Completed","dueDate":"2026-08-17","dueTime":"12:00","assignee":"emily@projects-consultant.com","priority":"Medium","startDate":"2026-08-17","startTime":"10:00"}'::jsonb),
('1u1zyukdf4qjmswod42w', '{"id":"1u1zyukdf4qjmswod42w","desc":"","notes":"","title":"T03W06S01: Physical Education - Morning Exercises!","listId":"2s2l6fpyxdgmswtno8v","status":"Completed","dueDate":"2026-08-17","dueTime":"09:30","assignee":"lucas@projects-consultant.com","priority":"Medium","startDate":"2026-08-17","startTime":"08:45"}'::jsonb),
('0ew4uwir0yvmswo92ax', '{"id":"0ew4uwir0yvmswo92ax","desc":"","notes":"","title":"T03W06S01: Khan Academy - Mathematics!","listId":"fkvtra7wif9mswtno8v","status":"Completed","dueDate":"2026-08-17","dueTime":"11:45","assignee":"lucas@projects-consultant.com","priority":"Medium","startDate":"2026-08-17","startTime":"09:45"}'::jsonb),
('w60g5ni4tlmswiy1hf', '{"id":"w60g5ni4tlmswiy1hf","desc":"Midday basketball session at UAC.","notes":"Arrived on time. Focused on passing drills and defence. Next session: work on shooting form.","title":"T03W06S01: Physical Education - Midday Sport (UAC Basketball)!","listId":"588i0w4b2f6mswtno8v","status":"Completed","dueDate":"2026-08-17","dueTime":"14:00","assignee":"lucas@projects-consultant.com","priority":"Medium","startDate":"2026-08-17","startTime":"12:00"}'::jsonb),
('l1l4pup6xn9mswoizxw', '{"id":"l1l4pup6xn9mswoizxw","desc":"","notes":"","title":"T03W06S01: Khan Academy - Science!","listId":"2au0643681rmswtno8v","status":"Planned","dueDate":"2026-08-17","dueTime":"17:00","assignee":"lucas@projects-consultant.com","priority":"Medium","startDate":"2026-08-17","startTime":"15:15"}'::jsonb)
on conflict (id) do update set data = excluded.data;
