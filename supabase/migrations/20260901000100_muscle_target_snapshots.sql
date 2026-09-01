begin;

alter table public.sets
  add column if not exists primary_muscle_group text,
  add column if not exists secondary_muscle_groups text[];

update public.sets as set_row
set primary_muscle_group = coalesce(set_row.primary_muscle_group, exercise.primary_muscle_group),
    secondary_muscle_groups = coalesce(set_row.secondary_muscle_groups, exercise.secondary_muscle_groups)
from public.exercises as exercise
where exercise.id = set_row.exercise_id
  and exercise.user_id = set_row.user_id
  and (set_row.primary_muscle_group is null or set_row.secondary_muscle_groups is null);

-- Keep the snapshot columns nullable during the rolling web deployment. Older
-- clients can still write sets, and readers fall back to the exercise row.
alter table public.sets
  alter column secondary_muscle_groups set default array[]::text[];

comment on column public.sets.primary_muscle_group is
  'Primary muscle target captured when the set is recorded; later exercise edits do not rewrite history.';
comment on column public.sets.secondary_muscle_groups is
  'Assisting muscle targets captured when the set is recorded; later exercise edits do not rewrite history.';

with revisions(id, primary_muscle_group, secondary_muscle_groups) as (
  values
    ('10000000-0000-4000-8000-000000000003'::uuid, 'upper_back', array['lats','biceps','rear_delts']::text[]),
    ('10000000-0000-4000-8000-000000000004'::uuid, 'front_delts', array['triceps','side_delts']::text[]),
    ('10000000-0000-4000-8000-000000000006'::uuid, 'rear_delts', array['middle_traps','rhomboids']::text[]),
    ('10000000-0000-4000-8000-000000000007'::uuid, 'quads', array['glutes','adductors']::text[]),
    ('10000000-0000-4000-8000-000000000010'::uuid, 'abs', array[]::text[]),
    ('10000000-0000-4000-8000-000000000020'::uuid, 'upper_back', array['lats','biceps','rear_delts']::text[]),
    ('10000000-0000-4000-8000-000000000025'::uuid, 'rear_delts', array['middle_traps','rhomboids']::text[]),
    ('10000000-0000-4000-8000-000000000029'::uuid, 'quads', array['glutes','adductors']::text[]),
    ('10000000-0000-4000-8000-000000000030'::uuid, 'quads', array['glutes','adductors']::text[]),
    ('10000000-0000-4000-8000-000000000040'::uuid, 'abs', array[]::text[]),
    ('10000000-0000-4000-8000-000000000045'::uuid, 'quads', array['glutes','adductors']::text[]),
    ('10000000-0000-4000-8000-000000000047'::uuid, 'chest', array['triceps','front_delts','serratus_anterior']::text[]),
    ('10000000-0000-4000-8000-000000000050'::uuid, 'obliques', array['abs']::text[]),
    ('10000000-0000-4000-8000-000000000055'::uuid, 'serratus_anterior', array[]::text[])
)
update public.exercises as exercise
set primary_muscle_group = revisions.primary_muscle_group,
    secondary_muscle_groups = revisions.secondary_muscle_groups,
    updated_at = now(),
    client_updated_at = now()
from revisions
where exercise.id = revisions.id;

commit;
