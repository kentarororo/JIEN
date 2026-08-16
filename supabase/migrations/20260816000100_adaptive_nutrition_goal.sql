alter table public.nutrition_targets
  add column desired_weekly_weight_change_percent numeric(5, 2) not null default 0;

alter table public.nutrition_targets
  add constraint nutrition_targets_desired_weight_change_valid check (
    desired_weekly_weight_change_percent >= -1
    and desired_weekly_weight_change_percent <= 1
  );

comment on column public.nutrition_targets.desired_weekly_weight_change_percent is
  'User-chosen weekly body-weight trend percentage. Never inferred from a broad fitness goal.';
