-- Extend handle_new_user_subscription to read marketing_opt_in from auth user metadata
-- and set marketing_emails_opted_in / marketing_opt_in_at at signup time.
-- This works without an active client session, fixing the silent-failure issue when
-- Supabase email confirmation is enabled.

create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opt_in boolean;
begin
  -- Read the marketing_opt_in flag from raw_user_meta_data, default to false
  opt_in := coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false);

  insert into public.subscriptions (
    user_id,
    plan,
    status,
    marketing_emails_opted_in,
    marketing_opt_in_at
  )
  values (
    new.id,
    'free',
    'trial',
    opt_in,
    case when opt_in then now() else null end
  );

  return new;
end;
$$;
