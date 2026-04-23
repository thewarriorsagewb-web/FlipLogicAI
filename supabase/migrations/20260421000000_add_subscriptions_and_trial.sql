-- Subscriptions, trial/usage tracking, and related triggers/policies

-- 1) subscriptions table
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free' constraint subscriptions_plan_check check (
    plan in ('free', 'investor_monthly', 'investor_annual')
  ),
  status text not null default 'trial' constraint subscriptions_status_check check (
    status in ('trial', 'active', 'past_due', 'canceled', 'expired')
  ),
  trial_deals_used integer not null default 0,
  trial_deals_limit integer not null default 5,
  current_period_end timestamptz,
  monthly_ai_deals_count integer not null default 0,
  monthly_ai_deals_reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_user_id_key unique (user_id)
);

comment on table public.subscriptions is 'Per-user subscription and AI/trial usage (Stripe and limits).';

-- 2) RLS + policies (no DELETE for authenticated; service_role policy for webhooks)
alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own"
  on public.subscriptions
  for select
  to authenticated
  using ( (select auth.uid()) = user_id );

create policy "subscriptions_insert_own"
  on public.subscriptions
  for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "subscriptions_update_own"
  on public.subscriptions
  for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "subscriptions_service_role_all"
  on public.subscriptions
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

-- 3) New user -> default subscription row
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'trial');
  return new;
end;
$$;

create trigger on_auth_user_created_create_subscription
  after insert on auth.users
  for each row
  execute function public.handle_new_user_subscription();

-- 4) deals: AI analysis flag + index
alter table public.deals
  add column ai_analysis_used boolean not null default false;

create index idx_deals_user_id_ai_analysis_used
  on public.deals (user_id, ai_analysis_used);

-- 5) Backfill: demo deal + users without a subscription
update public.deals
set ai_analysis_used = true
where id = '27695e3f-a022-4c13-8f8e-6d290ba5b9d4';

insert into public.subscriptions (user_id, plan, status, trial_deals_used)
select u.id, 'free', 'trial', 0
from auth.users u
where not exists (
  select 1
  from public.subscriptions s
  where s.user_id = u.id
);

-- 6) updated_at on subscriptions
create or replace function public.set_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger on_subscriptions_updated_set_timestamp
  before update on public.subscriptions
  for each row
  execute function public.set_subscriptions_updated_at();
