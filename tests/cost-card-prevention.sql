begin;
do $$
declare owner_id uuid; outsider_id uuid; s uuid:=gen_random_uuid(); other_shop uuid:=gen_random_uuid();
begin
 select id into owner_id from auth.users order by created_at limit 1;
 select id into outsider_id from auth.users where id<>owner_id order by created_at limit 1;
 assert owner_id is not null and outsider_id is not null;
 insert into public.shops(id,owner_id,name,slug) values
 (s,owner_id,'__cost_prevention__',s::text),(other_shop,outsider_id,'__cost_prevention_other__',other_shop::text);
 insert into public.sku_costs(shop_id,article,cost_price) values(s,'Top-114',1160),(other_shop,'NEW-1',900);
 perform set_config('test.shop_id',s::text,true);
 perform set_config('test.other_shop_id',other_shop::text,true);
 perform set_config('test.owner_id',owner_id::text,true);
end; $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner_id'),true);
do $$
declare s uuid:=current_setting('test.shop_id')::uuid; denied boolean:=false; failed boolean:=false;
begin
 assert public.seed_cost_cards(s,'[{"article":"top-114"},{"article":" TOP-114 "},{"article":"new-1"},{"article":"NEW-1"}]')=1;
 assert (select count(*)=2 and max(cost_price)=1160 from public.sku_costs where shop_id=s);
 assert (select cost_price=0 from public.sku_costs where shop_id=s and article='new-1'),'other store price must not be inherited';
 assert public.seed_cost_cards(s,'[{"article":"Top-114"},{"article":"new-1"}]')=0,'repeated imports never duplicate cards';
 perform public.save_cost_prices(s,'[{"article":"NEW-1","cost_price":300}]');
 assert (select count(*)=1 and min(cost_price)=300 from public.sku_costs where shop_id=s and lower(btrim(article))='new-1');
 perform public.save_cost_prices(s,'[{"article":"New-1","cost_price":310}]');
 assert (select count(*)=1 and min(cost_price)=310 from public.sku_costs where shop_id=s and lower(btrim(article))='new-1');
 assert public.seed_cost_cards(s,'[{"article":"nEw-1","cost_price":0}]')=0;
 assert (select cost_price=310 from public.sku_costs where shop_id=s and article='new-1');
 begin
  perform public.seed_cost_cards(s,'[{"article":"aa-new"},{"article":"zz-new"},null]');
 exception when others then failed:=true;
 end;
 assert failed;
 assert not exists(select 1 from public.sku_costs where shop_id=s and article='aa-new'),'invalid batch must roll back all seeds';
 begin
  perform public.seed_cost_cards(current_setting('test.other_shop_id')::uuid,'[{"article":"secret-new"}]');
 exception when insufficient_privilege then denied:=true;
 end;
 assert denied,'foreign shop seed must fail under RLS';
end; $$;
reset role;
do $$ begin
 assert (select cost_price=900 from public.sku_costs where shop_id=current_setting('test.other_shop_id')::uuid);
 assert not has_function_privilege('anon','public.seed_cost_cards(uuid,jsonb)','execute');
 assert has_function_privilege('service_role','public.seed_cost_cards(uuid,jsonb)','execute');
 assert position('pg_advisory_xact_lock' in pg_get_functiondef('public.seed_cost_cards(uuid,jsonb)'::regprocedure))>0;
 assert position('pg_advisory_xact_lock' in pg_get_functiondef('public.save_cost_prices(uuid,jsonb)'::regprocedure))>0;
end; $$;
select 'PASS: new-store case/space deduplication, prices retained, repeat imports/edits, atomic rollback, shop RLS, shared concurrency locks' as result;
rollback;
