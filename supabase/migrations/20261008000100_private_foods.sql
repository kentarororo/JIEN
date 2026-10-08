begin;

-- Owner library stays private under RLS. Only an explicit, revocable projection is shared.
create table public.private_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  catalog_id text not null check (catalog_id like 'custom-%' and length(catalog_id) <= 200),
  name text not null check (length(btrim(name)) between 1 and 160),
  brand text check (brand is null or length(btrim(brand)) between 1 and 160),
  barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  serving_quantity numeric not null check (serving_quantity > 0 and serving_quantity <= 1000000),
  serving_unit text not null check (length(btrim(serving_unit)) between 1 and 48),
  calories_kcal numeric not null check (calories_kcal between 0 and 1000000),
  protein_g numeric not null check (protein_g between 0 and 1000000),
  carbohydrate_g numeric not null check (carbohydrate_g between 0 and 1000000),
  fat_g numeric not null check (fat_g between 0 and 1000000),
  fibre_g numeric check (fibre_g is null or fibre_g between 0 and 1000000),
  is_shared boolean not null default false,
  community_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, catalog_id)
);
create index private_foods_user_sync_idx on public.private_foods(user_id, client_updated_at, id);
create index private_foods_user_barcode_idx on public.private_foods(user_id, barcode) where deleted_at is null;
create index private_foods_shared_barcode_idx on public.private_foods(barcode)
  where is_shared and not community_hidden and deleted_at is null;
create trigger private_foods_set_updated_at before update on public.private_foods
  for each row execute function private.set_updated_at();
alter table public.private_foods enable row level security;
alter table public.private_foods force row level security;
revoke all on public.private_foods from public, anon, authenticated;
grant select on public.private_foods to authenticated;
-- Moderation is server-only; an owner cannot undo a moderation decision.
grant insert (id, user_id, catalog_id, name, brand, barcode, serving_quantity, serving_unit,
  calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g, is_shared,
  created_at, updated_at, client_updated_at, deleted_at) on public.private_foods to authenticated;
grant update (id, user_id, catalog_id, name, brand, barcode, serving_quantity, serving_unit,
  calories_kcal, protein_g, carbohydrate_g, fat_g, fibre_g, is_shared,
  created_at, updated_at, client_updated_at, deleted_at) on public.private_foods to authenticated;
grant all on public.private_foods to service_role;
create policy private_foods_select_owner on public.private_foods for select to authenticated
  using ((select auth.uid()) = user_id);
create policy private_foods_insert_owner on public.private_foods for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy private_foods_update_owner on public.private_foods for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Deliberate RLS exception: authenticated discovery of opted-in product fields only.
-- Never return user_id, private catalog_id, meal records, photos, notes or activity timestamps.
create function public.search_community_foods(search_query text default '', product_barcode text default null)
returns table (id uuid, name text, brand text, barcode text, serving_quantity numeric,
  serving_unit text, calories_kcal numeric, protein_g numeric, carbohydrate_g numeric,
  fat_g numeric, fibre_g numeric)
language sql stable security definer set search_path = ''
as $$
  select f.id, f.name, f.brand, f.barcode, f.serving_quantity, f.serving_unit,
    f.calories_kcal, f.protein_g, f.carbohydrate_g, f.fat_g, f.fibre_g
  from public.private_foods f
  where (select auth.uid()) is not null
    and f.is_shared and not f.community_hidden and f.deleted_at is null
    and (
      (product_barcode ~ '^[0-9]{8,14}$' and f.barcode = product_barcode)
      or (product_barcode is null and length(btrim(search_query)) between 2 and 160
        and not exists (
          select 1 from pg_catalog.unnest(pg_catalog.regexp_split_to_array(lower(btrim(search_query)), '\s+')) token
          where position(token in lower(f.name || ' ' || coalesce(f.brand, ''))) = 0
        ))
    )
  order by f.name, f.id
  limit 20;
$$;
revoke all on function public.search_community_foods(text, text) from public, anon;
grant execute on function public.search_community_foods(text, text) to authenticated;

commit;
