alter table public.sets add column group_id uuid;

create index sets_workout_group_idx
  on public.sets(user_id, workout_id, group_id, sort_order)
  where deleted_at is null and group_id is not null;

comment on column public.sets.group_id is
  'Optional client-generated superset/circuit identifier. Presentation and logging order only.';
