-- Ordinary seeded zeros remain unknown; only explicit owner confirmation
-- enables a zero cost. Existing row access policies and all prices stay intact.
alter table public.sku_costs
  add column zero_cost_confirmed boolean not null default false;

comment on column public.sku_costs.zero_cost_confirmed is
  'Owner explicitly confirmed a zero cost; default zero placeholders remain unknown.';
