alter table public.meals
  add column if not exists is_user_edited boolean not null default false;

alter table public.food_items
  add column if not exists original_source public.meal_source,
  add column if not exists original_confidence numeric(4, 3),
  add column if not exists is_user_edited boolean not null default false;

update public.food_items
set original_source = coalesce(original_source, source),
    original_confidence = coalesce(original_confidence, confidence)
where original_source is null
   or (original_confidence is null and confidence is not null);

alter table public.food_items
  alter column original_source set default 'manual',
  alter column original_source set not null;

alter table public.food_items
  add constraint food_items_original_confidence_valid
    check (original_confidence is null or (original_confidence >= 0 and original_confidence <= 1))
    not valid;

alter table public.food_items
  validate constraint food_items_original_confidence_valid;
