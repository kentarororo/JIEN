begin;

-- Owned by the existing users row; its RLS and logical-clock trigger still apply.
-- Nullable and additive: older clients omit this column on profile writes.
alter table public.users add column if not exists training_programme jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass
    and conname = 'users_training_programme_object') then
    alter table public.users add constraint users_training_programme_object
      check (training_programme is null or jsonb_typeof(training_programme) = 'object');
  end if;
end $$;
comment on column public.users.training_programme is
  'Versioned user-chosen training goal, session frequency and priority-muscle set-credit targets. Not an inferred prescription.';

commit;
