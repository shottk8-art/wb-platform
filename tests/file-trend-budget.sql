-- Synthetic fixtures only. Verify aggregate amounts and caller RLS; rollback.
begin;
do $$
declare owner_id uuid; outsider_id uuid; s uuid:=gen_random_uuid();
begin
 select id into owner_id from auth.users order by created_at limit 1;
 select id into outsider_id from auth.users where id<>owner_id order by created_at limit 1;
 assert owner_id is not null and outsider_id is not null;
 insert into public.shops(id,owner_id,name,slug) values(s,owner_id,'__file_trend_budget__',s::text);
 insert into public.monthly_reports(shop_id,marketplace,year,month,sales_amount,transfer_total) values(s,'wildberries',2026,9,1000,900);
 insert into public.sku_sales(shop_id,marketplace,year,month,article,bought_qty,revenue) values(s,'wildberries',2026,9,'TEST',2,1000);
 insert into public.sku_costs(shop_id,article,cost_price) values(s,'TEST',380);
 insert into public.uploads(shop_id,marketplace,kind,filename,periods,year,month) values
 (s,'wildberries','summary','synthetic.xlsx','[{"year":2026,"month":9}]',null,null),
 (s,'wildberries','sales','synthetic.xlsx',null,2026,9);
 perform set_config('test.shop_id',s::text,true);
 perform set_config('test.owner_id',owner_id::text,true);
 perform set_config('test.outsider_id',outsider_id::text,true);
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner_id'),true);
do $$ begin
 assert (select count(*)=1 and min(cogs)=760 from public.get_file_trend(current_setting('test.shop_id')::uuid,'wildberries'));
 assert not exists(select 1 from public.get_file_trend(current_setting('test.shop_id')::uuid,'ozon'));
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.outsider_id'),true);
do $$ begin assert not exists(select 1 from public.get_file_trend(current_setting('test.shop_id')::uuid,'wildberries')); end; $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin assert not exists(select 1 from public.get_file_trend(current_setting('test.shop_id')::uuid,'wildberries')); end; $$;
reset role;
update public.shops set share_enabled=true where id=current_setting('test.shop_id')::uuid;
set local role anon;
do $$ begin assert (select count(*)=1 and min(cogs)=760 from public.get_file_trend(current_setting('test.shop_id')::uuid,'wildberries')); end; $$;
reset role;
select 'PASS: scoped live COGS, owner access, stranger/anon isolation, shared storefront, Ozon separation' as result;
rollback;
