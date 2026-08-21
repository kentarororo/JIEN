begin;

with starter(id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups, equipment, target_rep_min, target_rep_max, load_increment) as (
  values
    ('10000000-0000-4000-8000-000000000051'::uuid, 'Dumbbell Shrug', 'scapular_elevation', 'upper_traps', array['forearms']::text[], 'dumbbell', 8, 15, 2::numeric),
    ('10000000-0000-4000-8000-000000000052'::uuid, 'Prone Y Raise', 'scapular_upward_rotation', 'lower_traps', array['rotator_cuff','rear_delts']::text[], 'dumbbell', 12, 20, 1::numeric),
    ('10000000-0000-4000-8000-000000000053'::uuid, 'Chest-supported Rear Row', 'scapular_retraction', 'middle_traps', array['rhomboids','rear_delts']::text[], 'dumbbell', 10, 15, 2::numeric),
    ('10000000-0000-4000-8000-000000000054'::uuid, 'Tibialis Raise', 'dorsiflexion', 'tibialis_anterior', array[]::text[], 'bodyweight', 12, 25, 1::numeric),
    ('10000000-0000-4000-8000-000000000055'::uuid, 'Cable Serratus Punch', 'scapular_protraction', 'serratus_anterior', array['chest']::text[], 'cable', 12, 20, 1.25::numeric),
    ('10000000-0000-4000-8000-000000000056'::uuid, 'Standing Cable Hip Flexion', 'hip_flexion', 'hip_flexors', array['abs']::text[], 'cable', 10, 15, 1.25::numeric)
)
insert into public.exercises (
  id, user_id, name, movement_pattern, primary_muscle_group, secondary_muscle_groups,
  equipment, target_rep_min, target_rep_max, load_increment, created_at, updated_at, client_updated_at
)
select starter.id, users.id, starter.name, starter.movement_pattern, starter.primary_muscle_group,
  starter.secondary_muscle_groups, starter.equipment, starter.target_rep_min,
  starter.target_rep_max, starter.load_increment, now(), now(), now()
from starter cross join public.users
on conflict (id, user_id) do nothing;

update public.exercises set secondary_muscle_groups = array['lats','biceps','middle_traps','rhomboids'], client_updated_at = now()
where id = '10000000-0000-4000-8000-000000000003';
update public.exercises set secondary_muscle_groups = array['upper_back','middle_traps','rhomboids'], client_updated_at = now()
where id in ('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000025');
update public.exercises set secondary_muscle_groups = array['middle_traps','lower_traps','rotator_cuff'], client_updated_at = now()
where id = '10000000-0000-4000-8000-000000000026';
update public.exercises set primary_muscle_group = 'hip_abductors', secondary_muscle_groups = array['glutes'], client_updated_at = now()
where id = '10000000-0000-4000-8000-000000000033';
update public.exercises set primary_muscle_group = 'hip_flexors', secondary_muscle_groups = array['abs'], client_updated_at = now()
where id = '10000000-0000-4000-8000-000000000041';
update public.exercises set primary_muscle_group = 'brachialis', secondary_muscle_groups = array['biceps','forearms'], client_updated_at = now()
where id = '10000000-0000-4000-8000-000000000037';

commit;
