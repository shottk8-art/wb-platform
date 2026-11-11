-- Reuse ready financial aggregates for advertising-only preparation.
-- No WB request and no persistent data changes.
begin;
set local statement_timeout='5s';
do $$
declare pilot uuid:='853b81a0-e0e2-4195-bc80-1cdc362af946';
  month_start date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;
  original public.wb_api_preview_jobs; replacement public.wb_api_preview_jobs;
  before_count integer;
begin
  assert not has_function_privilege('anon','public.wb_api_queue_recent_unit(uuid)','execute');
  assert not has_function_privilege('authenticated','public.wb_api_queue_recent_unit(uuid)','execute');
  assert public.wb_api_queue_recent_unit('00000000-0000-4000-8000-000000000001')=0;
  select * into original from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start order by created_at desc limit 1;
  assert original.status='complete';
  select count(*) into before_count from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start;
  update public.wb_api_preview_jobs set summary=jsonb_set(summary,'{api_sources}',(summary->'api_sources')-'article_ads') where id=original.id;
  perform public.wb_api_queue_recent_unit(pilot);
  select * into replacement from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start and status='loading';
  assert replacement.summary->'pilot'->>'stage'='article_ads_debits';
  assert replacement.finance_model=original.finance_model and replacement.row_count=original.row_count and replacement.cursor_id=original.cursor_id;
  assert replacement.date_to=original.date_to,'reuse the exact saved period, not a moving end date';
  assert public.wb_api_queue_recent_unit(pilot)=0,'no duplicate active work';
  assert (select count(*)=before_count+1 from public.wb_api_preview_jobs where shop_id=pilot and date_from=month_start);
end; $$;
rollback;
