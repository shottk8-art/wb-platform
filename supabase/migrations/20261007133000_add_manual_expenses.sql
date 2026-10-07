alter table monthly_reports
  add column if not exists operational_expenses numeric not null default 0,
  add column if not exists external_promotion_expenses numeric not null default 0;

notify pgrst, 'reload schema';
