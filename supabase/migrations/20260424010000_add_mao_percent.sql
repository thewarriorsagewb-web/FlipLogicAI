-- Add MAO percentage field to deals table
alter table public.deals add column if not exists mao_percent numeric(5,2) not null default 70.00;

-- Constraint: MAO % must be between 1 and 100
alter table public.deals drop constraint if exists deals_mao_percent_check;
alter table public.deals add constraint deals_mao_percent_check
  check (mao_percent > 0 and mao_percent <= 100);
