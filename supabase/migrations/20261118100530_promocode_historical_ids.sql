-- Verified historical financial identifiers for the same saved WB Seller card.
-- Account mappings are imported privately; never infer them from similar names.
create table public.wb_promo_id_aliases (
  shop_id uuid not null,
  alias_id uuid not null,
  promo_id uuid not null,
  verified_at timestamptz not null default now(),
  primary key(shop_id,alias_id),
  foreign key(shop_id,promo_id) references public.wb_promo_names(shop_id,promo_id) on delete cascade,
  check(alias_id<>promo_id)
);
create index wb_promo_id_aliases_campaign_idx on public.wb_promo_id_aliases(shop_id,promo_id);
alter table public.wb_promo_id_aliases enable row level security;
revoke all on public.wb_promo_id_aliases from public,anon,authenticated;
grant all on public.wb_promo_id_aliases to service_role;
comment on table public.wb_promo_id_aliases is
  'Verified historical financial IDs of saved promo cards; private, shop scoped, canonical catalogue remains the audience boundary.';
