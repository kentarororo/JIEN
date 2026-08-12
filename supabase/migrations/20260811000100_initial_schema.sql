begin;

create extension if not exists pgcrypto;

create type public.load_unit as enum ('kg', 'lb');
create type public.experience_level as enum ('beginner', 'intermediate', 'advanced');
create type public.fitness_goal as enum (
  'composition',
  'strength',
  'both',
  'general_wellness'
);
create type public.workout_status as enum (
  'planned',
  'in_progress',
  'completed',
  'skipped'
);
create type public.set_kind as enum ('working', 'warmup', 'drop', 'failure');
create type public.meal_type as enum ('breakfast', 'lunch', 'dinner', 'snack', 'other');
create type public.meal_source as enum ('manual', 'ai_photo', 'imported');
create type public.ai_processing_status as enum (
  'not_requested',
  'pending',
  'processing',
  'completed',
  'failed'
);
create type public.nutrition_target_source as enum ('manual', 'adaptive');
create type public.wellness_source as enum ('manual', 'healthkit', 'health_connect');
create type public.ai_conversation_status as enum ('active', 'archived');
create type public.ai_message_role as enum ('user', 'assistant', 'system', 'tool');
create type public.notification_type as enum (
  'meal_gap',
  'workout_plan',
  'recovery_checkin',
  'photo_processed',
  'sync_issue'
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  preferred_load_unit public.load_unit not null default 'kg',
  training_experience public.experience_level,
  available_equipment text[] not null default array[]::text[],
  injury_flags jsonb not null default '[]'::jsonb,
  goals public.fitness_goal[] not null default array[]::public.fitness_goal[],
  typical_diet_pattern text,
  ai_data_consent boolean not null default false,
  ai_data_consented_at timestamptz,
  onboarding_completed_at timestamptz,
  medical_disclaimer_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  constraint users_timezone_not_blank check (btrim(timezone) <> ''),
  constraint users_injury_flags_is_array check (jsonb_typeof(injury_flags) = 'array'),
  constraint users_ai_consent_has_timestamp check (
    not ai_data_consent or ai_data_consented_at is not null
  )
);

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  movement_pattern text not null,
  primary_muscle_group text not null,
  secondary_muscle_groups text[] not null default array[]::text[],
  equipment text,
  target_rep_min smallint not null default 8,
  target_rep_max smallint not null default 12,
  load_increment numeric(8, 2) not null default 2.5,
  notes text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint exercises_name_not_blank check (btrim(name) <> ''),
  constraint exercises_movement_pattern_not_blank check (btrim(movement_pattern) <> ''),
  constraint exercises_primary_muscle_not_blank check (btrim(primary_muscle_group) <> ''),
  constraint exercises_rep_range_valid check (
    target_rep_min > 0 and target_rep_max >= target_rep_min
  ),
  constraint exercises_load_increment_positive check (load_increment > 0),
  unique (id, user_id)
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  title text not null default 'Workout',
  status public.workout_status not null default 'in_progress',
  performed_on date not null default current_date,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint workouts_title_not_blank check (btrim(title) <> ''),
  constraint workouts_time_order_valid check (
    completed_at is null or started_at is null or completed_at >= started_at
  ),
  unique (id, user_id)
);

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  workout_id uuid not null,
  exercise_id uuid not null,
  sort_order integer not null,
  kind public.set_kind not null default 'working',
  reps smallint not null,
  load_value numeric(10, 3) not null,
  load_unit public.load_unit not null default 'kg',
  rpe numeric(3, 1),
  completed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sets_workout_owner_fk foreign key (workout_id, user_id)
    references public.workouts (id, user_id) on delete cascade,
  constraint sets_exercise_owner_fk foreign key (exercise_id, user_id)
    references public.exercises (id, user_id)
    on delete no action deferrable initially deferred,
  constraint sets_sort_order_nonnegative check (sort_order >= 0),
  constraint sets_reps_positive check (reps > 0),
  constraint sets_load_nonnegative check (load_value >= 0),
  constraint sets_rpe_valid check (rpe is null or (rpe >= 1 and rpe <= 10))
);

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null default 'Meal',
  type public.meal_type,
  eaten_on date not null default current_date,
  eaten_at timestamptz not null default now(),
  source public.meal_source not null default 'manual',
  notes text,
  photo_storage_path text,
  ai_context text,
  ai_status public.ai_processing_status not null default 'not_requested',
  ai_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint meals_name_not_blank check (btrim(name) <> ''),
  unique (id, user_id)
);

create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  meal_id uuid not null,
  sort_order integer not null default 0,
  name text not null,
  quantity numeric(10, 3) not null default 1,
  unit text not null default 'serving',
  calories_kcal numeric(10, 2) not null,
  protein_g numeric(10, 2) not null default 0,
  carbohydrate_g numeric(10, 2) not null default 0,
  fat_g numeric(10, 2) not null default 0,
  fibre_g numeric(10, 2),
  source public.meal_source not null default 'manual',
  confidence numeric(4, 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint food_items_meal_owner_fk foreign key (meal_id, user_id)
    references public.meals (id, user_id) on delete cascade,
  constraint food_items_sort_order_nonnegative check (sort_order >= 0),
  constraint food_items_name_not_blank check (btrim(name) <> ''),
  constraint food_items_quantity_positive check (quantity > 0),
  constraint food_items_unit_not_blank check (btrim(unit) <> ''),
  constraint food_items_calories_nonnegative check (calories_kcal >= 0),
  constraint food_items_protein_nonnegative check (protein_g >= 0),
  constraint food_items_carbohydrate_nonnegative check (carbohydrate_g >= 0),
  constraint food_items_fat_nonnegative check (fat_g >= 0),
  constraint food_items_fibre_nonnegative check (fibre_g is null or fibre_g >= 0),
  constraint food_items_confidence_valid check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

create table public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  effective_from date not null,
  effective_to date,
  calories_kcal numeric(10, 2) not null,
  protein_g numeric(10, 2) not null,
  carbohydrate_g numeric(10, 2) not null,
  fat_g numeric(10, 2) not null,
  fibre_g numeric(10, 2),
  source public.nutrition_target_source not null default 'manual',
  rationale text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint nutrition_targets_date_range_valid check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint nutrition_targets_calories_positive check (calories_kcal > 0),
  constraint nutrition_targets_protein_nonnegative check (protein_g >= 0),
  constraint nutrition_targets_carbohydrate_nonnegative check (carbohydrate_g >= 0),
  constraint nutrition_targets_fat_nonnegative check (fat_g >= 0),
  constraint nutrition_targets_fibre_nonnegative check (fibre_g is null or fibre_g >= 0)
);

create table public.wellness_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null,
  logged_on date not null default current_date,
  logged_at timestamptz not null default now(),
  source public.wellness_source not null default 'manual',
  mood_score smallint,
  energy_score smallint,
  stress_score smallint,
  soreness_score smallint,
  motivation_score smallint,
  sleep_duration_minutes integer,
  sleep_quality_score smallint,
  body_weight_kg numeric(7, 3),
  injury_flags jsonb not null default '[]'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint wellness_logs_kind_not_blank check (btrim(kind) <> ''),
  constraint wellness_logs_mood_score_valid check (mood_score is null or mood_score between 1 and 5),
  constraint wellness_logs_energy_score_valid check (energy_score is null or energy_score between 1 and 5),
  constraint wellness_logs_stress_score_valid check (stress_score is null or stress_score between 1 and 5),
  constraint wellness_logs_soreness_score_valid check (soreness_score is null or soreness_score between 1 and 5),
  constraint wellness_logs_motivation_score_valid check (motivation_score is null or motivation_score between 1 and 5),
  constraint wellness_logs_sleep_quality_valid check (sleep_quality_score is null or sleep_quality_score between 1 and 5),
  constraint wellness_logs_sleep_duration_valid check (
    sleep_duration_minutes is null or sleep_duration_minutes between 0 and 1440
  ),
  constraint wellness_logs_body_weight_positive check (body_weight_kg is null or body_weight_kg > 0),
  constraint wellness_logs_injury_flags_is_array check (jsonb_typeof(injury_flags) = 'array'),
  constraint wellness_logs_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  purpose text not null default 'wellness',
  title text,
  status public.ai_conversation_status not null default 'active',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ai_conversations_purpose_not_blank check (btrim(purpose) <> ''),
  unique (id, user_id)
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  conversation_id uuid not null,
  sequence integer not null,
  role public.ai_message_role not null,
  content text not null default '',
  structured_content jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  model text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ai_messages_conversation_owner_fk foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id) on delete cascade,
  constraint ai_messages_sequence_nonnegative check (sequence >= 0),
  constraint ai_messages_structured_content_is_object check (
    jsonb_typeof(structured_content) = 'object'
  ),
  constraint ai_messages_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint ai_messages_has_content check (
    btrim(content) <> '' or structured_content <> '{}'::jsonb
  ),
  unique (conversation_id, sequence)
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.notification_type not null,
  enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text not null default 'UTC',
  minimum_interval_minutes integer not null default 720,
  last_notified_at timestamptz,
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint notification_preferences_timezone_not_blank check (btrim(timezone) <> ''),
  constraint notification_preferences_interval_nonnegative check (
    minimum_interval_minutes >= 0
  ),
  constraint notification_preferences_conditions_is_object check (
    jsonb_typeof(conditions) = 'object'
  ),
  unique (user_id, type)
);

create unique index sets_active_workout_sort_order_uidx
  on public.sets (workout_id, sort_order)
  where deleted_at is null;
create unique index nutrition_targets_active_start_uidx
  on public.nutrition_targets (user_id, effective_from)
  where deleted_at is null;

create index exercises_user_active_idx
  on public.exercises (user_id, name)
  where deleted_at is null;
create index exercises_user_sync_idx
  on public.exercises (user_id, client_updated_at, id);
create index workouts_user_timeline_idx
  on public.workouts (user_id, performed_on desc, started_at desc)
  where deleted_at is null;
create index workouts_user_sync_idx
  on public.workouts (user_id, client_updated_at, id);
create index sets_workout_idx
  on public.sets (workout_id, sort_order)
  where deleted_at is null;
create index sets_exercise_history_idx
  on public.sets (user_id, exercise_id, completed_at desc)
  where deleted_at is null;
create index sets_user_sync_idx
  on public.sets (user_id, client_updated_at, id);
create index meals_user_timeline_idx
  on public.meals (user_id, eaten_on desc, eaten_at desc)
  where deleted_at is null;
create index meals_user_sync_idx
  on public.meals (user_id, client_updated_at, id);
create index food_items_meal_idx
  on public.food_items (meal_id, sort_order)
  where deleted_at is null;
create index food_items_user_sync_idx
  on public.food_items (user_id, client_updated_at, id);
create index nutrition_targets_user_dates_idx
  on public.nutrition_targets (user_id, effective_from desc, effective_to)
  where deleted_at is null;
create index nutrition_targets_user_sync_idx
  on public.nutrition_targets (user_id, client_updated_at, id);
create index wellness_logs_user_timeline_idx
  on public.wellness_logs (user_id, logged_on desc, logged_at desc)
  where deleted_at is null;
create index wellness_logs_user_sync_idx
  on public.wellness_logs (user_id, client_updated_at, id);
create index ai_conversations_user_recent_idx
  on public.ai_conversations (user_id, last_message_at desc nulls last)
  where deleted_at is null;
create index ai_conversations_user_sync_idx
  on public.ai_conversations (user_id, client_updated_at, id);
create index ai_messages_conversation_idx
  on public.ai_messages (conversation_id, sequence)
  where deleted_at is null;
create index ai_messages_user_sync_idx
  on public.ai_messages (user_id, client_updated_at, id);
create index notification_preferences_user_sync_idx
  on public.notification_preferences (user_id, client_updated_at, id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A delayed offline client must not overwrite a newer logical write.
  -- Returning OLD makes client_updated_at the last-write-wins clock while the
  -- normal updated_at column remains server-controlled.
  if new.client_updated_at < old.client_updated_at then
    return old;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users',
    'exercises',
    'workouts',
    'sets',
    'meals',
    'food_items',
    'nutrition_targets',
    'wellness_logs',
    'ai_conversations',
    'ai_messages',
    'notification_preferences'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

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
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

insert into public.users (id, display_name)
select
  id,
  nullif(btrim(raw_user_meta_data ->> 'display_name'), '')
from auth.users
on conflict (id) do nothing;

alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.exercises enable row level security;
alter table public.exercises force row level security;
alter table public.workouts enable row level security;
alter table public.workouts force row level security;
alter table public.sets enable row level security;
alter table public.sets force row level security;
alter table public.meals enable row level security;
alter table public.meals force row level security;
alter table public.food_items enable row level security;
alter table public.food_items force row level security;
alter table public.nutrition_targets enable row level security;
alter table public.nutrition_targets force row level security;
alter table public.wellness_logs enable row level security;
alter table public.wellness_logs force row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_conversations force row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;

create policy users_select_own
  on public.users for select to authenticated
  using ((select auth.uid()) = id);
create policy users_insert_own
  on public.users for insert to authenticated
  with check ((select auth.uid()) = id);
create policy users_update_own
  on public.users for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'exercises',
    'workouts',
    'sets',
    'meals',
    'food_items',
    'nutrition_targets',
    'wellness_logs',
    'notification_preferences'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name || '_insert_own',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_update_own',
      table_name
    );
  end loop;
end;
$$;

create policy ai_conversations_select_own
  on public.ai_conversations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_conversations_insert_own_with_consent
  on public.ai_conversations for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.users as profile
      where profile.id = (select auth.uid())
        and profile.ai_data_consent
    )
  );
create policy ai_conversations_update_own
  on public.ai_conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy ai_messages_select_own
  on public.ai_messages for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_messages_insert_user_role_with_consent
  on public.ai_messages for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and role = 'user'
    and exists (
      select 1
      from public.users as profile
      where profile.id = (select auth.uid())
        and profile.ai_data_consent
    )
  );
create policy ai_messages_update_own
  on public.ai_messages for update to authenticated
  using (
    (select auth.uid()) = user_id
    and role = 'user'
  )
  with check (
    (select auth.uid()) = user_id
    and role = 'user'
  );

revoke all on table
  public.users,
  public.exercises,
  public.workouts,
  public.sets,
  public.meals,
  public.food_items,
  public.nutrition_targets,
  public.wellness_logs,
  public.ai_conversations,
  public.ai_messages,
  public.notification_preferences
from public, anon, authenticated;

grant select, insert, update on table
  public.users,
  public.exercises,
  public.workouts,
  public.sets,
  public.meals,
  public.food_items,
  public.nutrition_targets,
  public.wellness_logs,
  public.ai_conversations,
  public.ai_messages,
  public.notification_preferences
to authenticated;

commit;
