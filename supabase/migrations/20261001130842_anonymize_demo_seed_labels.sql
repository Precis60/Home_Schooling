-- Anonymize published demo/seed labels on project rkmrzflpgrdqnfdexens only.
-- Does not delete auth users, does not change login emails, and does not
-- change hs_spaces ids (student RLS matches those ids to the JWT email).

create or replace function public.hs_anonymize_demo_labels(node jsonb)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  result jsonb := '{}'::jsonb;
  arr jsonb := '[]'::jsonb;
  key text;
  val jsonb;
  elem jsonb;
  node_id text;
  name_text text;
begin
  if node is null then
    return null;
  elsif jsonb_typeof(node) = 'array' then
    for elem in select value from jsonb_array_elements(node)
    loop
      arr := arr || jsonb_build_array(public.hs_anonymize_demo_labels(elem));
    end loop;
    return arr;
  elsif jsonb_typeof(node) = 'object' then
    node_id := coalesce(node->>'id', '');
    for key, val in select e.key, e.value from jsonb_each(node) as e
    loop
      if key = 'name' and jsonb_typeof(val) = 'string' then
        name_text := val #>> '{}';
        if node_id = '588i0w4b2f6mswtno8v' then
          result := result || jsonb_build_object(key, 'Sample afternoon sport');
        elsif node_id like 'sporting-%'
          and name_text ~ '[[:space:]]Activities$'
          and name_text is distinct from 'Sporting activities' then
          result := result || jsonb_build_object(key, 'Sporting activities');
        else
          result := result || jsonb_build_object(key, name_text);
        end if;
      else
        result := result || jsonb_build_object(key, public.hs_anonymize_demo_labels(val));
      end if;
    end loop;
    return result;
  else
    return node;
  end if;
end;
$fn$;

revoke all on function public.hs_anonymize_demo_labels(jsonb) from public;
revoke all on function public.hs_anonymize_demo_labels(jsonb) from anon;
revoke all on function public.hs_anonymize_demo_labels(jsonb) from authenticated;

update public.hs_spaces
set data = public.hs_anonymize_demo_labels(data),
    updated_at = now()
where data is distinct from public.hs_anonymize_demo_labels(data);

-- Clear notes/descriptions that are still an exact copy of the original
-- seed task, including that seed row. Other notes are left alone.
with seed as (
  select data->>'notes' as notes, data->>'desc' as descr
  from public.hs_tasks
  where id = 'w60g5ni4tlmswiy1hf'
)
update public.hs_tasks t
set data = t.data
  || case
       when coalesce(seed.notes, '') <> '' and t.data->>'notes' = seed.notes
         then jsonb_build_object('notes', '')
       else '{}'::jsonb
     end
  || case
       when coalesce(seed.descr, '') <> '' and t.data->>'desc' = seed.descr
         then jsonb_build_object('desc', 'Example activity for a new install.')
       else '{}'::jsonb
     end,
    updated_at = now()
from seed
where t.id <> 'w60g5ni4tlmswiy1hf'
  and (
    (coalesce(seed.notes, '') <> '' and t.data->>'notes' = seed.notes)
    or (coalesce(seed.descr, '') <> '' and t.data->>'desc' = seed.descr)
  );

update public.hs_tasks
set data = data || jsonb_build_object(
      'title', 'Sample physical education session',
      'desc', 'Example activity for a new install.',
      'notes', ''
    ),
    updated_at = now()
where id = 'w60g5ni4tlmswiy1hf';

insert into public.hs_users (id, data)
select 'main',
  coalesce((
    select jsonb_object_agg(
      email,
      jsonb_build_object('name', 'Student ' || rn::text, 'role', 'student')
    )
    from (
      select lower(u.email) as email,
             row_number() over (order by u.created_at, u.id) as rn
      from auth.users u
      where coalesce(u.raw_app_meta_data->>'role', '') = 'student'
        and u.email is not null
    ) students
  ), '{}'::jsonb)
where not exists (select 1 from public.hs_users where id = 'main');

drop function if exists public.hs_anonymize_demo_labels(jsonb);
