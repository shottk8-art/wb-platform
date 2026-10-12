-- Nullable: old uploads and accruals do not establish how many units were ordered.
alter table public.monthly_reports add column if not exists orders_qty integer;
