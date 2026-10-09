-- Private API inputs: never exposed through public shop sharing or file reports.
create table if not exists public.wb_api_month_settings (
  shop_id uuid not null references public.shops(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  operational_expenses numeric not null default 0 check (operational_expenses between 0 and 1000000000),
  external_promotion_expenses numeric not null default 0 check (external_promotion_expenses between 0 and 1000000000),
  media_spend numeric check (media_spend between 0 and 1000000000),
  updated_at timestamptz not null default now(),
  primary key (shop_id, month)
);
alter table public.wb_api_month_settings enable row level security;
revoke all on public.wb_api_month_settings from anon, authenticated;
grant all on public.wb_api_month_settings to service_role;
