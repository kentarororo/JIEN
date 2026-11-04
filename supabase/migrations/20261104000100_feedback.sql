create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('bug', 'idea', 'confusing')),
  message text not null check (char_length(message) between 1 and 2000),
  context jsonb not null,
  screenshot_base64 text check (screenshot_base64 is null or char_length(screenshot_base64) <= 2000000),
  github_issue_number bigint,
  github_issue_url text,
  client_created_at timestamptz not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index feedback_user_created_idx on public.feedback(user_id, created_at desc);

alter table public.feedback enable row level security;
alter table public.feedback force row level security;

create policy "Users can read their own feedback"
  on public.feedback for select
  using ((select auth.uid()) = user_id);

create trigger feedback_set_updated_at
  before update on public.feedback
  for each row execute function private.set_updated_at();

revoke all on table public.feedback from anon;
grant select on table public.feedback to authenticated;
