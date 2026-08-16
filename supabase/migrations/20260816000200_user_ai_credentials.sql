begin;

create extension if not exists supabase_vault with schema vault;

create table private.user_ai_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null default 'gemini',
  model text not null,
  vault_secret_id uuid not null unique references vault.secrets (id) on delete restrict,
  acknowledgement_version text not null default 'gemini-free-tier-2026-08-16',
  billing_acknowledged_at timestamptz not null default now(),
  free_tier_data_acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_ai_credentials_provider_valid check (provider = 'gemini'),
  constraint user_ai_credentials_model_not_blank check (btrim(model) <> '')
);

create table private.ai_usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  usage_kind text not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, usage_kind),
  constraint ai_usage_daily_kind_valid check (usage_kind in ('photo', 'context')),
  constraint ai_usage_daily_count_nonnegative check (request_count >= 0)
);

alter table private.user_ai_credentials enable row level security;
alter table private.user_ai_credentials force row level security;
alter table private.ai_usage_daily enable row level security;
alter table private.ai_usage_daily force row level security;

revoke all on table private.user_ai_credentials, private.ai_usage_daily
  from public, anon, authenticated;

create or replace function public.set_user_ai_credential(
  p_user_id uuid,
  p_provider text,
  p_model text,
  p_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
  next_secret_id uuid;
begin
  if p_user_id is null or p_provider <> 'gemini' then
    raise exception 'invalid AI credential owner or provider';
  end if;
  if p_model is null or btrim(p_model) = '' then
    raise exception 'invalid AI model';
  end if;
  if p_secret is null or length(btrim(p_secret)) < 20 or length(btrim(p_secret)) > 512 then
    raise exception 'invalid AI credential';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  select credential.vault_secret_id
    into existing_secret_id
  from private.user_ai_credentials as credential
  where credential.user_id = p_user_id
  for update;

  if existing_secret_id is null then
    select vault.create_secret(
      btrim(p_secret),
      'jien-user-gemini-' || p_user_id::text,
      'User-owned Gemini key for JIEN AI features'
    ) into next_secret_id;
  else
    perform vault.update_secret(existing_secret_id, btrim(p_secret));
    next_secret_id := existing_secret_id;
  end if;

  insert into private.user_ai_credentials (
    user_id,
    provider,
    model,
    vault_secret_id
  ) values (
    p_user_id,
    p_provider,
    p_model,
    next_secret_id
  )
  on conflict (user_id) do update set
    provider = excluded.provider,
    model = excluded.model,
    vault_secret_id = excluded.vault_secret_id,
    acknowledgement_version = 'gemini-free-tier-2026-08-16',
    billing_acknowledged_at = now(),
    free_tier_data_acknowledged_at = now(),
    updated_at = now();
end;
$$;

create or replace function private.delete_user_ai_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

revoke all on function private.delete_user_ai_vault_secret()
  from public, anon, authenticated;

create trigger user_ai_credentials_delete_vault_secret
  after delete on private.user_ai_credentials
  for each row execute function private.delete_user_ai_vault_secret();

create or replace function public.get_user_ai_configuration(p_user_id uuid)
returns table (provider text, model text, api_key text)
language sql
security definer
set search_path = ''
stable
as $$
  select
    credential.provider,
    credential.model,
    secret.decrypted_secret as api_key
  from private.user_ai_credentials as credential
  join vault.decrypted_secrets as secret
    on secret.id = credential.vault_secret_id
  where credential.user_id = p_user_id;
$$;

create or replace function public.delete_user_ai_credential(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  delete from private.user_ai_credentials
  where user_id = p_user_id;
end;
$$;

create or replace function public.claim_user_ai_usage(
  p_user_id uuid,
  p_usage_kind text,
  p_daily_limit integer
)
returns table (allowed boolean, used integer, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_utc date := (now() at time zone 'utc')::date;
  current_count integer;
  next_count integer;
begin
  if p_user_id is null
    or p_usage_kind not in ('photo', 'context')
    or p_daily_limit < 1
    or p_daily_limit > 1000 then
    raise exception 'invalid AI usage claim';
  end if;

  insert into private.ai_usage_daily (user_id, usage_date, usage_kind, request_count)
  values (p_user_id, today_utc, p_usage_kind, 0)
  on conflict (user_id, usage_date, usage_kind) do nothing;

  select usage.request_count
    into current_count
  from private.ai_usage_daily as usage
  where usage.user_id = p_user_id
    and usage.usage_date = today_utc
    and usage.usage_kind = p_usage_kind
  for update;

  if current_count >= p_daily_limit then
    return query select false, current_count, 0,
      ((today_utc + 1)::timestamp at time zone 'utc');
    return;
  end if;

  next_count := current_count + 1;
  update private.ai_usage_daily
  set request_count = next_count, updated_at = now()
  where user_id = p_user_id
    and usage_date = today_utc
    and usage_kind = p_usage_kind;

  return query select true, next_count, greatest(0, p_daily_limit - next_count),
    ((today_utc + 1)::timestamp at time zone 'utc');
end;
$$;

revoke all on function public.set_user_ai_credential(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_user_ai_configuration(uuid)
  from public, anon, authenticated;
revoke all on function public.delete_user_ai_credential(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_user_ai_usage(uuid, text, integer)
  from public, anon, authenticated;

grant execute on function public.set_user_ai_credential(uuid, text, text, text)
  to service_role;
grant execute on function public.get_user_ai_configuration(uuid)
  to service_role;
grant execute on function public.delete_user_ai_credential(uuid)
  to service_role;
grant execute on function public.claim_user_ai_usage(uuid, text, integer)
  to service_role;

comment on table private.user_ai_credentials is
  'Server-only mapping from a JIEN account to an encrypted Supabase Vault secret. Plaintext keys never enter public application tables.';
comment on table private.ai_usage_daily is
  'Server-enforced UTC request allowance for cost and abuse control; it is not provider billing data.';

commit;
