-- When true, deal was created after trial exhaustion without AI; AI features remain blocked
alter table public.deals add column if not exists ai_locked boolean not null default false;
