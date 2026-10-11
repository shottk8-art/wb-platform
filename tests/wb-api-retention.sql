-- Synthetic compact snapshots only; no API, Vault or real shop mutations.
begin;
do $$
declare owner_id uuid; s uuid:=gen_random_uuid(); summary jsonb; model jsonb; loading_id uuid;
begin
 select id into owner_id from auth.users order by created_at limit 1;
 insert into public.shops(id,owner_id,name,slug) values(s,owner_id,'__retention_budget__',s::text);
 insert into public.wb_api_connections(shop_id,secret_id,seller_id,seller_name) values(s,gen_random_uuid(),s::text,'Synthetic');
 summary='{"pilot":{"stage":"media_stats"},"api_sources":{"orders":{"status":"downloaded"},"internal_ads":{"status":"downloaded"},"media":{"status":"downloaded"}}}';
 model='{"version":1,"cursor_id":"0","row_count":0,"totals":{},"products":[]}';
 insert into public.wb_api_preview_jobs(shop_id,date_from,date_to,status,summary,finance_model,finance_storage,created_at) values
 (s,'2026-09-01','2026-09-30','complete',summary,model,'aggregate',now()-interval '5 minutes'),
 (s,'2026-09-01','2026-09-30','complete',summary,model,'aggregate',now()-interval '4 minutes'),
 (s,'2026-09-01','2026-09-30','loading',summary,model,'aggregate',now()-interval '3 minutes'),
 (s,'2026-08-01','2026-08-31','complete',summary,model,'aggregate',now()-interval '1 day'),
 (s,'2026-09-01','2026-09-30','error',summary,model,'aggregate',now());
 select id into loading_id from public.wb_api_preview_jobs where shop_id=s and status='loading';
 update public.wb_api_preview_jobs set status='complete' where id=loading_id;
 assert (select count(*)=2 from public.wb_api_preview_jobs where shop_id=s and date_from='2026-09-01' and status='complete');
 assert exists(select 1 from public.wb_api_preview_jobs where id=loading_id);
 assert (select count(*)=1 from public.wb_api_preview_jobs where shop_id=s and status='error');
 assert exists(select 1 from public.wb_api_preview_jobs where shop_id=s and date_from='2026-08-01');
 assert not has_function_privilege('anon','public.wb_api_prune_snapshots(uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.wb_api_housekeeping()','EXECUTE');
end; $$;
select 'PASS: two ready snapshots, new snapshot retained, historical/error data intact, private cleanup' as result;
rollback;
