-- Synthetic data only; transaction is rolled back, no real seller API call.
begin;
set transaction read write;
set local request.jwt.claims='{"role":"service_role"}';
do $$
declare s uuid; j uuid; owner_id uuid; m jsonb; summary jsonb; result boolean;
begin
  select id into owner_id from auth.users order by created_at limit 1;
  insert into public.shops(owner_id,name,slug) values(owner_id,'__test_compact__','test-compact-'||gen_random_uuid()) returning id into s;
  insert into public.wb_api_connections(shop_id,secret_id,seller_id,seller_name) values(s,gen_random_uuid(),'test-'||s,'Synthetic');
  insert into public.wb_api_preview_jobs(shop_id,date_from,date_to,summary) values(s,'2026-09-01','2026-09-30','{"pilot":{"stage":"finance"}}') returning id into j;
  m='{"version":1,"cursor_id":"1","row_count":1,"bought_qty":1,"totals":{"retailAmount":"100.01","forPay":"80.07"},"products":[{"article":"SKU","name":"Test","bought_qty":1,"revenue":"100.01","for_pay":"80.07"}]}';
  summary='{"row_count":1,"pilot":{"stage":"finance"},"totals":{"retailAmount":"100.01","forPay":"80.07"}}';
  result=public.wb_api_commit_finance_page(j,s,0,0,1,summary,m,'loading');assert result;
  assert not exists(select 1 from public.wb_api_preview_rows where job_id=j);
  assert (select finance_model=m and cursor_id=1 and row_count=1 and finance_storage='aggregate' from public.wb_api_preview_jobs where id=j);
  result=public.wb_api_commit_finance_page(j,s,0,0,1,summary,m,'loading');assert not result;
  begin
    perform public.wb_api_commit_finance_page(j,s,1,1,2,jsonb_set(summary,'{totals,forPay}','"99.99"'),jsonb_set(m,'{cursor_id}','"2"'),'loading');
    raise exception 'Invalid totals were accepted';
  exception when raise_exception then assert sqlerrm='Finance totals mismatch'; end;
  assert (select finance_model=m and cursor_id=1 from public.wb_api_preview_jobs where id=j);
  begin
    insert into public.wb_api_preview_rows(job_id,rrd_id,payload) values(j,2,'{}');
    raise exception 'Raw storage reopened';
  exception when raise_exception then assert sqlerrm='Raw operation storage is disabled for compact snapshots'; end;
  assert not has_function_privilege('anon','public.wb_api_commit_finance_page(uuid,uuid,bigint,bigint,bigint,jsonb,jsonb,text)','EXECUTE');
  assert not has_function_privilege('authenticated','public.wb_api_commit_finance_page(uuid,uuid,bigint,bigint,bigint,jsonb,jsonb,text)','EXECUTE');
end; $$;
rollback;
