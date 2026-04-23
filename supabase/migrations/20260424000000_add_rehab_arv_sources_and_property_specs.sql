-- Add multi-source rehab cost fields
alter table public.deals add column if not exists rehab_initial_estimate numeric;
alter table public.deals add column if not exists rehab_manual_override numeric;
alter table public.deals add column if not exists rehab_cost_source text not null default 'initial';

-- Add ARV source tracking
alter table public.deals add column if not exists arv_initial_estimate numeric;
alter table public.deals add column if not exists arv_source text not null default 'initial';

-- Add property specs
alter table public.deals add column if not exists subject_bedrooms integer;
alter table public.deals add column if not exists subject_bathrooms numeric(3,1);

-- Backfill existing deals: move current rehab_cost into rehab_initial_estimate, same for arv
update public.deals
set rehab_initial_estimate = coalesce(rehab_initial_estimate, rehab_cost)
where rehab_cost is not null;

update public.deals
set arv_initial_estimate = coalesce(arv_initial_estimate, arv)
where arv is not null;

-- Add check constraints for source values
alter table public.deals drop constraint if exists deals_rehab_cost_source_check;
alter table public.deals add constraint deals_rehab_cost_source_check
  check (rehab_cost_source in ('initial', 'ai_walkthrough', 'manual'));

alter table public.deals drop constraint if exists deals_arv_source_check;
alter table public.deals add constraint deals_arv_source_check
  check (arv_source in ('initial', 'comp_derived'));
