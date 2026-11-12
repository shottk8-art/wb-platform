-- No WB/Ozon calls; every test record and change rolls back.
begin;
do $$
declare shop uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); other_user uuid; payload jsonb;
 denied boolean:=false; n integer; journal uuid; reports integer;
begin
 select owner_id into other_user from public.shops where owner_id<>'bbb002c4-cd7a-490d-b9c0-72aed5424261' limit 1;
 insert into public.shops(id,owner_id,name,slug) values(shop,'bbb002c4-cd7a-490d-b9c0-72aed5424261','__ozon_analytics_test__',shop::text),(outsider,other_user,'__ozon_analytics_test__',outsider::text);
 payload:=jsonb_build_array(jsonb_build_object('report',jsonb_build_object('year',2026,'month',9,'sales_amount',100,'orders_amount',100,'bought_qty',1,'transfer_goods',100,'transfer_total',100,'delivery_cost',0,'storage_cost',0,'fines',0,'acceptance_ops',0,'damage_comp',0,'return_comp',0,'other_fees',0,'ads_spend',0,'ads_promo_spend',0),
 'skus',jsonb_build_array(jsonb_build_object('article','SKU','name','Товар','bought_qty',1,'revenue',100)),
 'analytics',jsonb_build_object('version',1,'coverage',jsonb_build_object('from','2026-09-01','to','2026-09-30','declared',true),'totals',jsonb_build_object('rows',1,'sales','100.00','net','100.00','quantity',1),'days',jsonb_build_object('2026-09-01',jsonb_build_object('rows',1,'sales','100.00','net','100.00','quantity',1,'groups','{}'::jsonb,'products',jsonb_build_array(jsonb_build_object('article','SKU','quantity',1)))),'products',jsonb_build_array(jsonb_build_object('article','SKU','name','Товар','rows',1,'sales','100.00','net','100.00','quantity',1,'groups','{}'::jsonb)))));
 perform set_config('request.jwt.claim.sub','bbb002c4-cd7a-490d-b9c0-72aed5424261',true);
 n:=public.import_ozon_report(shop,'test.xlsx',payload,1);assert n=1;
 assert (select count(*)=1 from public.ozon_analytics_months where shop_id=shop);
 assert (select count(*)=1 from public.sku_sales where shop_id=shop and marketplace='ozon');
 update public.monthly_reports set operational_expenses=123,external_promotion_expenses=45 where shop_id=shop;
 assert exists(select 1 from public.ozon_analytics_months where shop_id=shop),'manual costs do not invalidate daily/direct data';
 insert into public.sku_sales(shop_id,marketplace,year,month,article,bought_qty,revenue) values(shop,'ozon',2026,9,'obsolete',1,1);
 perform public.import_ozon_report(shop,'test2.xlsx',payload,1);
 assert (select operational_expenses=123 and external_promotion_expenses=45 from public.monthly_reports where shop_id=shop);
 assert not exists(select 1 from public.sku_sales where shop_id=shop and article='obsolete');
 select count(*) into reports from public.uploads where shop_id=shop;
 begin perform public.import_ozon_report(shop,'bad.xlsx',jsonb_set(payload,'{0,analytics,totals,sales}','"200.00"'),1);exception when others then denied:=true;end;
 assert denied;assert (select count(*)=reports from public.uploads where shop_id=shop),'invalid model rolls the journal back';denied:=false;
 begin perform public.import_ozon_report(outsider,'forbidden.xlsx',payload,1);exception when others then denied:=true;end;assert denied;denied:=false;
 perform set_config('request.jwt.claim.sub',other_user::text,true);
 begin perform public.import_ozon_report(shop,'forbidden.xlsx',payload,1);exception when others then denied:=true;end;assert denied;
 assert not has_table_privilege('authenticated','public.ozon_analytics_months','SELECT');
 assert not has_table_privilege('anon','public.ozon_analytics_months','SELECT');
 assert not has_function_privilege('anon','public.import_ozon_report(uuid,text,jsonb,integer)','EXECUTE');
 update public.monthly_reports set sales_amount=sales_amount+1 where shop_id=shop;
 assert not exists(select 1 from public.ozon_analytics_months where shop_id=shop),'a changed legacy source removes stale details immediately';
 perform set_config('request.jwt.claim.sub','bbb002c4-cd7a-490d-b9c0-72aed5424261',true);
 perform public.import_ozon_report(shop,'replace.xlsx',payload,1);
 select upload_id into journal from public.ozon_analytics_months where shop_id=shop;
 delete from public.uploads where id=journal;
 assert not exists(select 1 from public.ozon_analytics_months where shop_id=shop),'undo of its source removes private aggregates';
end; $$;
rollback;
