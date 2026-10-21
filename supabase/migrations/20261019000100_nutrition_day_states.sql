begin;

do $$
begin
  create type public.nutrition_day_state as enum ('partial', 'complete');
exception
  when duplicate_object then null;
end
$$;

create table public.nutrition_day_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  logged_on date not null,
  state public.nutrition_day_state not null default 'partial',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, logged_on)
);

create index nutrition_day_states_user_sync_idx
  on public.nutrition_day_states(user_id, client_updated_at, id);
create index nutrition_day_states_user_date_idx
  on public.nutrition_day_states(user_id, logged_on desc)
  where deleted_at is null;

create trigger nutrition_day_states_set_updated_at
  before update on public.nutrition_day_states
  for each row execute function private.set_updated_at();

alter table public.nutrition_day_states enable row level security;
alter table public.nutrition_day_states force row level security;

revoke all on public.nutrition_day_states from public, anon, authenticated;
grant select, insert, update on public.nutrition_day_states to authenticated;
grant all on public.nutrition_day_states to service_role;

create policy nutrition_day_states_select_own
  on public.nutrition_day_states for select to authenticated
  using ((select auth.uid()) = user_id);
create policy nutrition_day_states_insert_own
  on public.nutrition_day_states for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy nutrition_day_states_update_own
  on public.nutrition_day_states for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
