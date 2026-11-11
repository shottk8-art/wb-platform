-- Run against the deployed migration. Everything rolls back; no WB HTTP call.
begin;
set local statement_timeout='5s';
do $$
declare pilot uuid:='853b81a0-e0e2-4195-bc80-1cdc362af946';
  month_start date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;
  current_job uuid; before_count integer; after_count integer;
begin
  assert not has_function_privilege('anon','public.wb_api_queue_recent_unit(uuid)','execute');
  assert not has_function_privilege('authenticated','public.wb_api_queue_recent_unit(uuid)','execute');
  assert has_function_privilege('service_role','public.wb_api_queue_recent_unit(uuid)','execute');
  assert public.wb_api_queue_recent_unit('00000000-0000-4000-8000-000000000001')=0;
  select id into current_job from public.wb_api_preview_jobs
    where shop_id=pilot and date_from=month_start order by created_at desc limit 1;
  assert (select status='complete' and finance_model->'unit'->>'version'='1'
    from public.wb_api_preview_jobs where id=current_job),'A ready current month is required for this rollback test';
  select count(*) into before_count from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start;
  -- Simulate the compact unit coverage missing from an old saved snapshot.
  update public.wb_api_preview_jobs set finance_model=finance_model-'unit' where id=current_job;
  assert public.wb_api_queue_recent_unit(pilot)=1,'missing unit coverage must queue the recent month automatically';
  assert public.wb_api_queue_recent_unit(pilot)=0,'an active preload must not be queued twice';
  select count(*) into after_count from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start;
  assert after_count=before_count+1,'exactly one new current-month job';
  assert (select count(*)=1 from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start and status='loading');
end; $$;
rollback;
