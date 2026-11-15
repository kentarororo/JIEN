begin;

create table public.recipes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  servings numeric not null check (servings > 0 and servings <= 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (id),
  unique (id, user_id)
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  name text not null check (length(btrim(name)) between 1 and 160),
  quantity numeric not null check (quantity > 0 and quantity <= 1000000),
  serving_quantity numeric not null check (serving_quantity > 0 and serving_quantity <= 1000000),
  serving_unit text not null check (length(btrim(serving_unit)) between 1 and 48),
  calories_kcal numeric not null check (calories_kcal between 0 and 1000000),
  protein_g numeric not null check (protein_g between 0 and 1000000),
  carbohydrate_g numeric not null check (carbohydrate_g between 0 and 1000000),
  fat_g numeric not null check (fat_g between 0 and 1000000),
  fibre_g numeric check (fibre_g is null or fibre_g between 0 and 1000000),
  source text not null,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (recipe_id, user_id) references public.recipes(id, user_id) on delete cascade
);

create index recipes_user_sync_idx on public.recipes(user_id, client_updated_at, id);
create index recipe_ingredients_user_sync_idx on public.recipe_ingredients(user_id, client_updated_at, id);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id, sort_order)
  where deleted_at is null;

create trigger recipes_set_updated_at before update on public.recipes
  for each row execute function private.set_updated_at();
create trigger recipe_ingredients_set_updated_at before update on public.recipe_ingredients
  for each row execute function private.set_updated_at();

alter table public.recipes enable row level security;
alter table public.recipes force row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_ingredients force row level security;
revoke all on public.recipes, public.recipe_ingredients from public, anon, authenticated;
grant select, insert, update on public.recipes, public.recipe_ingredients to authenticated;
grant all on public.recipes, public.recipe_ingredients to service_role;

create policy recipes_select_owner on public.recipes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recipes_insert_owner on public.recipes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy recipes_update_owner on public.recipes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recipe_ingredients_select_owner on public.recipe_ingredients for select to authenticated
  using ((select auth.uid()) = user_id);
create policy recipe_ingredients_insert_owner on public.recipe_ingredients for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy recipe_ingredients_update_owner on public.recipe_ingredients for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

commit;
