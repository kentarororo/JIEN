begin;

-- Starter exercises intentionally keep stable IDs across devices. Scope their
-- identity to the owner so two users can sync the same starter catalog safely.
alter table public.sets drop constraint sets_exercise_owner_fk;
alter table public.exercises drop constraint exercises_id_user_id_key;
alter table public.exercises drop constraint exercises_pkey;
alter table public.exercises
  add constraint exercises_pkey primary key (id, user_id);
alter table public.sets
  add constraint sets_exercise_owner_fk foreign key (exercise_id, user_id)
  references public.exercises (id, user_id)
  on delete no action deferrable initially deferred;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
    )
  )
  on conflict (id) do update
    set display_name = coalesce(public.users.display_name, excluded.display_name);

  return new;
end;
$$;

update public.users as profile
set display_name = coalesce(
  profile.display_name,
  nullif(btrim(account.raw_user_meta_data ->> 'display_name'), ''),
  nullif(btrim(account.raw_user_meta_data ->> 'full_name'), ''),
  nullif(btrim(account.raw_user_meta_data ->> 'name'), '')
)
from auth.users as account
where account.id = profile.id
  and profile.display_name is null;

commit;
