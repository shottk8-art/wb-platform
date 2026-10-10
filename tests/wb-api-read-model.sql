-- Run with a trusted database connection. All synthetic rows roll back;
-- no seller token or real shop data is used or deleted.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
do $$
declare s uuid; j uuid; empty_job uuid; m jsonb; cached jsonb; owner_id uuid;
begin
  select id into owner_id from auth.users order by created_at limit 1;
  insert into public.shops(owner_id,name,slug)
    values(owner_id,'__test_read_model__','test-read-model-'||gen_random_uuid()) returning id into s;
  insert into public.wb_api_connections(shop_id,secret_id,seller_id,seller_name)
    values(s,gen_random_uuid(),'test-'||s,'Synthetic');
  insert into public.wb_api_preview_jobs(shop_id,date_from,date_to,cursor_id,row_count)
    values(s,'2026-09-01','2026-09-30',6,6) returning id into j;
  insert into public.wb_api_preview_rows(job_id,rrd_id,payload) values
    (j,1,'{"vendorCode":"SKU","title":"First title","sellerOperName":"Продажа","docTypeName":"Продажа","quantity":2,"retailAmount":"100.10","forPay":"80.10","deliveryService":2,"cashbackAmount":5,"cashbackDiscount":2,"cashbackCommissionChange":1,"additionalPayment":3}'),
    (j,2,'{"vendorCode":"SKU","title":"Later title","sellerOperName":"Возврат","docTypeName":"Возврат","quantity":1,"retailAmount":"20.10","forPay":"16.10","deliveryService":1,"cashbackAmount":2,"cashbackDiscount":1,"cashbackCommissionChange":"0.50","additionalPayment":"0.10"}'),
    (j,3,'{"vendorCode":"SKU","sellerOperName":"Коррекция продаж","docTypeName":"Продажа","quantity":1,"forPay":5}'),
    (j,4,'{"sellerOperName":"Удержание","bonusTypeName":"WB.Медиа","deduction":9}'),
    (j,5,'{"vendorCode":"RETURN","sellerOperName":"Возврат","docTypeName":"Возврат","quantity":2,"retailAmount":"2.22","forPay":"1.11"}'),
    (j,6,'{"nmId":0,"sellerOperName":"Продажа","docTypeName":"Продажа","quantity":50,"retailAmount":"0.01","forPay":"0.01"}'),
    (j,7,'{"retailAmount":1000}'); -- uncommitted worker tail, must be ignored
  m=public.wb_api_finance_read_model(j);
  assert m->>'row_count'='6'; assert m->>'bought_qty'='-1';
  assert m->'totals'->>'retailAmount'='77.79'; assert m->'totals'->>'forPay'='67.90';
  assert m->'totals'->>'deliveryService'='3.00'; assert m->'totals'->>'cashbackAmount'='3.00';
  assert m->'totals'->>'cashbackDiscount'='1.00'; assert m->'totals'->>'cashbackCommissionChange'='0.50';
  assert m->'totals'->>'additionalPayment'='3.10'; assert m->'totals'->>'advertisingDeductions'='9.00';
  assert m->'products'->1->>'article'='SKU'; assert m->'products'->1->>'name'='First title';
  assert m->'products'->1->>'bought_qty'='1'; assert m->'products'->1->>'for_pay'='69.00';
  cached=public.wb_api_finance_read_model(j); assert cached=m;
  update public.wb_api_preview_jobs set cursor_id=7,row_count=7 where id=j;
  m=public.wb_api_finance_read_model(j);
  assert m->>'row_count'='7'; assert m->'totals'->>'retailAmount'='1077.79';
  insert into public.wb_api_preview_rows(job_id,rrd_id,payload)
    values(j,8,'{"vendorCode":"0","nmId":0,"sellerOperName":"Продажа","docTypeName":"Продажа","quantity":1,"retailAmount":3,"forPay":2}');
  update public.wb_api_preview_jobs set cursor_id=8,row_count=8 where id=j;
  m=public.wb_api_finance_read_model(j);
  assert exists (select 1 from jsonb_array_elements(m->'products') p where p->>'article'='0' and p->>'bought_qty'='1');
  insert into public.wb_api_preview_jobs(shop_id,date_from,date_to)
    values(s,'2026-08-01','2026-08-31') returning id into empty_job;
  m=public.wb_api_finance_read_model(empty_job);
  assert m->>'row_count'='0'; assert m->'products'='[]'::jsonb;
  assert m->'totals'->>'retailAmount'='0.00';
  assert not has_function_privilege('anon','public.wb_api_finance_read_model(uuid)','EXECUTE');
  assert not has_function_privilege('authenticated','public.wb_api_finance_read_model(uuid)','EXECUTE');
end; $$;
rollback;
