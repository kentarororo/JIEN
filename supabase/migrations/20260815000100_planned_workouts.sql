begin;

alter table public.workouts
  add column scheduled_at timestamptz,
  add column plan_json jsonb;

alter table public.workouts
  add constraint workouts_plan_json_is_object check (
    plan_json is null or jsonb_typeof(plan_json) = 'object'
  );

create index workouts_upcoming_plan_idx
  on public.workouts (user_id, scheduled_at, id)
  where status = 'planned' and deleted_at is null;

commit;
