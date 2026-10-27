begin;

alter table public.nutrition_targets
  add column weekly_check_in_day smallint;

alter table public.nutrition_targets
  add constraint nutrition_targets_weekly_check_in_day_valid check (
    weekly_check_in_day is null or weekly_check_in_day between 0 and 6
  );

comment on column public.nutrition_targets.weekly_check_in_day is
  'Optional local weekday for a review-only nutrition check-in: 0 Sunday through 6 Saturday.';

commit;
