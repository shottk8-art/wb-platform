alter table public.monthly_reports
  add column if not exists wb_media_spend numeric not null default 0,
  add column if not exists loyalty_points_spend numeric not null default 0,
  add column if not exists loyalty_program_fee numeric not null default 0;

alter table public.uploads drop constraint if exists uploads_kind_check;
alter table public.uploads
  add constraint uploads_kind_check check (
    kind in ('summary','sales','costs','ads','wb_financial_details','wb_media','ozon_accruals')
  );
