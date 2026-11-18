-- This private catalogue is the exact set of promo IDs exposed to viewers.
-- Names/codes are account data and are imported separately, never in migrations.
alter table public.wb_promo_names add column code text not null default ''
  check(length(code)<=64);
comment on table public.wb_promo_names is
  'TOPLASH curated promo catalogue. Only registered financial-report IDs are included in promo statistics. No direct client grants.';
