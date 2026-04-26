alter table public.subscriptions
  add column if not exists marketing_emails_opted_in boolean not null default false,
  add column if not exists marketing_opt_in_at timestamptz;

comment on column public.subscriptions.marketing_emails_opted_in is 'Whether the user opted in to marketing/promotional emails at signup or later.';
comment on column public.subscriptions.marketing_opt_in_at is 'Timestamp the user opted in to marketing emails. Null if never opted in.';
