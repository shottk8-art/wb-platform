-- Transaction-only fixtures. No WB calls, queues, emails or lasting grants.
begin;
set local statement_timeout='15s';
do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); foreign_shop uuid:=gen_random_uuid(); begin
 perform set_config('wb.test_a',a::text,true);perform set_config('wb.test_b',b::text,true);perform set_config('wb.test_c',c::text,true);perform set_config('wb.test_shop',s::text,true);perform set_config('wb.test_foreign',foreign_shop::text,true);
 insert into auth.users(id,aud,role,email,raw_user_meta_data) values(a,'authenticated','authenticated',a||'@example.invalid','{"telegram_username":"karlshott"}'),(b,'authenticated','authenticated',b||'@example.invalid','{}'),(c,'authenticated','authenticated',c||'@example.invalid','{}');
 insert into public.shops(id,owner_id,name,slug) values(s,a,'__section_test__',s::text),(foreign_shop,c,'__section_foreign__',foreign_shop::text);
 insert into public.shop_members(shop_id,user_id,telegram_username) values(s,b,'section_test_member');
 insert into public.monthly_reports(shop_id,marketplace,year,month,sales_amount) values(s,'wildberries',2026,9,123),(foreign_shop,'wildberries',2026,9,999);
 insert into public.sku_costs(shop_id,article,name,cost_price) values(s,'TEST','Test',5);
 insert into public.uploads(shop_id,marketplace,kind,filename) values(s,'wildberries','costs','__section_costs.xlsx');
end $$;
select set_config('request.jwt.claim.sub',current_setting('wb.test_a'),true),set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 assert public.app_section_allowed('overview');assert not public.app_section_allowed('daily');assert not public.app_section_allowed('stocks');assert not public.app_section_allowed('ai');
 begin perform public.admin_user_section_access(auth.uid());exception when insufficient_privilege then denied:=true;end;assert denied;denied:=false;
 begin perform public.app_section_allowed('overview',current_setting('wb.test_b')::uuid);exception when insufficient_privilege then denied:=true;end;assert denied;
 assert (select count(*) from public.monthly_reports where shop_id=current_setting('wb.test_shop')::uuid)=1;
 assert (select count(*) from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid)=0;
end $$;
reset role;
select set_config('request.jwt.claim.sub','bbb002c4-cd7a-490d-b9c0-72aed5424261',true),set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$ declare flags jsonb; r jsonb; denied boolean:=false; begin
 select jsonb_object_agg(k,false) into flags from unnest(array['overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes']) k;
 r:=public.admin_save_section_access(current_setting('wb.test_a')::uuid,flags);
 assert r->'sections'=flags,'save returns committed-in-transaction values';
 flags:=flags||'{"overview":true,"daily":true,"stocks":true,"reports":true,"account":true}';
 r:=public.admin_save_section_access(current_setting('wb.test_b')::uuid,flags);assert r->'sections'=flags;
 flags:=flags||'{"daily":false,"stocks":false,"reports":false}';
 perform public.admin_save_section_access(current_setting('wb.test_c')::uuid,flags);
 begin perform public.admin_save_section_access(auth.uid(),flags);exception when others then denied:=true;end;assert denied;denied:=false;
 begin perform public.admin_save_section_access(current_setting('wb.test_a')::uuid,'{"overview":true}');exception when others then denied:=true;end;assert denied;
 assert not (public.admin_user_section_access(current_setting('wb.test_a')::uuid)->'sections'->>'overview')::boolean;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('wb.test_a'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 assert (public.my_section_access()->>'user_id')::uuid=auth.uid();
 assert not public.app_section_allowed('overview');
 assert (select count(*) from public.monthly_reports where shop_id=current_setting('wb.test_shop')::uuid)=0;
 assert (select count(*) from public.sku_costs where shop_id=current_setting('wb.test_shop')::uuid)=0;
 assert (select count(*) from public.user_section_access where user_id=current_setting('wb.test_b')::uuid)=0;
 begin update public.user_section_access set allowed=true where user_id=auth.uid();exception when insufficient_privilege then denied:=true;end;assert denied;denied:=false;
 begin perform public.admin_save_section_access(auth.uid(),'{}');exception when insufficient_privilege then denied:=true;end;assert denied;
 assert (select count(*) from public.get_complete_periods(current_setting('wb.test_shop')::uuid,'wildberries'))=0;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('wb.test_b'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 assert public.app_section_allowed('daily');assert public.app_section_allowed('stocks');assert not public.app_section_allowed('costs');assert not public.app_section_allowed('settings');
 assert (select count(*) from public.monthly_reports where shop_id=current_setting('wb.test_shop')::uuid)=1;
 assert (select count(*) from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid)=0;
 assert (select count(*) from public.shop_members where user_id=auth.uid())=1,'closed team still permits own membership discovery';
 begin update public.sku_costs set cost_price=100 where shop_id=current_setting('wb.test_shop')::uuid;exception when insufficient_privilege then denied:=true;end;assert denied;denied:=false;
 begin perform public.save_cost_prices(current_setting('wb.test_shop')::uuid,'[{"article":"TEST","cost_price":100}]');exception when insufficient_privilege then denied:=true;end;assert denied;
 delete from public.sku_costs where shop_id=current_setting('wb.test_shop')::uuid;
 assert (select count(*) from public.sku_costs where shop_id=current_setting('wb.test_shop')::uuid and article='TEST')=1,'reports cannot delete purchase prices';
 delete from public.uploads where shop_id=current_setting('wb.test_shop')::uuid and kind='costs';
 assert (select count(*) from public.uploads where shop_id=current_setting('wb.test_shop')::uuid and kind='costs')=1,'reports alone cannot erase cost upload history';
 insert into public.sku_costs(shop_id,article,name,cost_price) values(current_setting('wb.test_shop')::uuid,'SEED','Import seed',0);
 assert not has_function_privilege('authenticated','public.app_shop_section_enabled(uuid,text)','EXECUTE');
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('wb.test_c'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 assert public.app_section_allowed('overview');assert not public.app_section_allowed('reports');
 begin update public.monthly_reports set sales_amount=1 where shop_id=current_setting('wb.test_foreign')::uuid;exception when insufficient_privilege then denied:=true;end;assert denied;denied:=false;
 delete from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid;
 assert (select sales_amount from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid)=999,'overview cannot delete reports';
 begin insert into public.monthly_reports(shop_id,marketplace,year,month,sales_amount) values(current_setting('wb.test_foreign')::uuid,'wildberries',2026,10,100);exception when insufficient_privilege then denied:=true;end;assert denied;denied:=false;
 begin insert into public.monthly_reports(shop_id,marketplace,year,month,sales_amount) values(current_setting('wb.test_foreign')::uuid,'wildberries',2026,9,100)
  on conflict(shop_id,marketplace,year,month) do update set sales_amount=excluded.sales_amount;exception when insufficient_privilege then denied:=true;end;assert denied;
 insert into public.monthly_reports(shop_id,marketplace,year,month,operational_expenses,external_promotion_expenses) values(current_setting('wb.test_foreign')::uuid,'wildberries',2026,9,10,2)
  on conflict(shop_id,marketplace,year,month) do update set operational_expenses=excluded.operational_expenses,external_promotion_expenses=excluded.external_promotion_expenses;
 assert (select operational_expenses=10 and external_promotion_expenses=2 and sales_amount=999 from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid),'manual-expense upsert remains valid without report access';
end $$;
reset role;
select set_config('request.jwt.claim.sub','bbb002c4-cd7a-490d-b9c0-72aed5424261',true);
set local role authenticated;
do $$ declare flags jsonb; begin
 select jsonb_object_agg(k,k in ('reports','account')) into flags from unnest(array['overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes']) k;
 perform public.admin_save_section_access(current_setting('wb.test_c')::uuid,flags);
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('wb.test_c'),true);
set local role authenticated;
do $$ declare denied boolean:=false; begin
 update public.monthly_reports set sales_amount=1000 where shop_id=current_setting('wb.test_foreign')::uuid;
 begin update public.monthly_reports set operational_expenses=100 where shop_id=current_setting('wb.test_foreign')::uuid;exception when insufficient_privilege then denied:=true;end;assert denied;
 delete from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid;
 assert (select operational_expenses=10 and sales_amount=1000 from public.monthly_reports where shop_id=current_setting('wb.test_foreign')::uuid),'reports cannot erase unrelated manual expenses';
end $$;
reset role;
select set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','',true);
do $$ begin
 assert public.app_shop_section_enabled(current_setting('wb.test_shop')::uuid,'stocks');
 assert public.app_shop_section_enabled(current_setting('wb.test_shop')::uuid,'daily');
 assert not public.app_shop_section_enabled(current_setting('wb.test_foreign')::uuid,'stocks');
 assert not has_table_privilege('anon','public.user_section_access','SELECT');
 assert not has_function_privilege('anon','public.admin_save_section_access(uuid,jsonb)','EXECUTE');
end $$;
rollback;
select 'Section SQL PASS: defaults, immutable admin, atomic saves, metadata spoof rejected, self-only rules, restrictive RLS, cost mutation guard, existing membership and scoped worker eligibility. All fixtures rolled back.' as result;
