begin;
do $$
declare owner_id uuid; outsider_id uuid; s uuid:=gen_random_uuid(); other_shop uuid:=gen_random_uuid();
begin
 select id into owner_id from auth.users order by created_at limit 1;
 select id into outsider_id from auth.users where id<>owner_id order by created_at limit 1;
 assert owner_id is not null and outsider_id is not null;
 insert into public.shops(id,owner_id,name,slug) values
 (s,owner_id,'__case_costs__',s::text),(other_shop,outsider_id,'__case_costs_other__',other_shop::text);
 insert into public.sku_costs(shop_id,article,cost_price) values
 (s,'Top-114',1160),(s,'top-114',0),(other_shop,'TOP-114',999);
 insert into public.monthly_reports(shop_id,marketplace,year,month,sales_amount,transfer_total) values(s,'wildberries',2026,9,4000,3000);
 insert into public.sku_sales(shop_id,marketplace,year,month,article,bought_qty,revenue) values(s,'wildberries',2026,9,'TOP-114',2,4000);
 insert into public.uploads(shop_id,marketplace,kind,filename,periods,year,month) values
 (s,'wildberries','summary','synthetic.xlsx','[{"year":2026,"month":9}]',null,null),
 (s,'wildberries','sales','synthetic.xlsx',null,2026,9);
 perform set_config('test.shop_id',s::text,true);
 perform set_config('test.other_shop_id',other_shop::text,true);
 perform set_config('test.owner_id',owner_id::text,true);
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner_id'),true);
do $$
declare denied boolean:=false; failed boolean:=false; s uuid:=current_setting('test.shop_id')::uuid;
begin
 assert (select cogs=2320 from public.get_file_trend(s,'wildberries')),'no case-induced zero or duplicated join';
 assert public.save_cost_prices(s,'[{"article":" TOP-114 ","cost_price":1200}]')=1;
 assert (select count(*)=2 and min(cost_price)=1200 and max(cost_price)=1200 from public.sku_costs where shop_id=s),'all aliases updated, no rows deleted';
 assert (select cogs=2400 from public.get_file_trend(s,'wildberries'));
 perform public.save_cost_prices(s,'[{"article":"top-114","cost_price":1250},{"article":"Top-114","cost_price":1300}]');
 assert (select min(cost_price)=1300 and max(cost_price)=1300 from public.sku_costs where shop_id=s),'last imported variant applies to all aliases';
 begin
  perform public.save_cost_prices(s,'[{"article":"top-114","cost_price":1},{"article":"bad","cost_price":-1}]');
 exception when others then failed:=true;
 end;
 assert failed;
 assert (select min(cost_price)=1300 from public.sku_costs where shop_id=s),'invalid batch rolls back earlier entries';
 begin
  perform public.save_cost_prices(current_setting('test.other_shop_id')::uuid,'[{"article":"top-114","cost_price":1}]');
 exception when insufficient_privilege then denied:=true;
 end;
 assert denied,'foreign shop writes must fail under RLS';
 perform public.save_cost_prices(s,'[{"article":"tOp-114","cost_price":0}]');
 assert (select min(cost_price)=0 and max(cost_price)=0 from public.sku_costs where shop_id=s),'undo/clearing resets all aliases';
 assert (select cogs=0 from public.get_file_trend(s,'wildberries'));
end; $$;
reset role;
do $$ begin
 assert (select cost_price=999 from public.sku_costs where shop_id=current_setting('test.other_shop_id')::uuid);
 assert not has_function_privilege('anon','public.save_cost_prices(uuid,jsonb)','execute');
end; $$;
select 'PASS: case-insensitive read/save/import/undo, atomic rollback, no duplicate joins, cross-shop RLS isolation' as result;
rollback;
