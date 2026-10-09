alter table public.monthly_reports
  add column if not exists wb_media_orders_amount numeric not null default 0;
