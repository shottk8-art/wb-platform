-- Regression for a 690-row file / 477 logical articles under normal RLS/timeout.
-- Every fixture and price edit is rolled back, including on connection failure.
begin;
set transaction read write;
set local statement_timeout='8s';
do $$
declare owner_id uuid; member_id uuid; outsider_id uuid;
  s uuid:=gen_random_uuid(); other_shop uuid:=gen_random_uuid();
begin
  select id into owner_id from auth.users order by created_at limit 1;
  select id into member_id from auth.users where id<>owner_id order by created_at limit 1;
  select id into outsider_id from auth.users where id not in(owner_id,member_id) order by created_at limit 1;
  assert owner_id is not null and member_id is not null and outsider_id is not null;
  insert into public.shops(id,owner_id,name,slug,share_enabled) values
    (s,owner_id,'__bulk_costs__',s::text,true),
    (other_shop,outsider_id,'__bulk_costs_other__',other_shop::text,false);
  insert into public.shop_members(shop_id,telegram_username,user_id)
    values(s,'__bulk_costs_member__',member_id);
  insert into public.sku_costs(shop_id,article,name,cost_price)
    select s,'sku-'||n,'Existing '||n,0 from generate_series(1,671) n;
  insert into public.sku_costs(shop_id,article,name,cost_price) values
    (s,'SKU-1','Alias',0),(other_shop,'sku-1','Other shop',999);
  perform set_config('test.shop_id',s::text,true);
  perform set_config('test.other_shop_id',other_shop::text,true);
  perform set_config('test.owner_id',owner_id::text,true);
  perform set_config('test.member_id',member_id::text,true);
  perform set_config('test.outsider_id',outsider_id::text,true);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner_id'),true);
do $$
declare s uuid:=current_setting('test.shop_id')::uuid; rows jsonb; failed boolean:=false;
begin
  select jsonb_agg(jsonb_build_object('article',' sku-'||((n-1)%477+1)||' ',
    'name',case when n<=477 then 'Imported '||n else '' end,'cost_price',n::numeric/100)
    order by n) into rows from generate_series(1,690) n;
  assert public.save_cost_prices(s,rows)=477;
  assert (select count(*)=672 from public.sku_costs where shop_id=s),'no new aliases';
  assert (select count(*)=478 from public.sku_costs where shop_id=s and cost_price>0);
  assert (select min(cost_price)=4.78 and max(cost_price)=4.78
    from public.sku_costs where shop_id=s and lower(btrim(article))='sku-1');
  assert (select bool_and(name='Imported 1') from public.sku_costs
    where shop_id=s and lower(btrim(article))='sku-1'),'last nonempty imported name retained';
  assert (select cost_price=0 and name='Existing 671' from public.sku_costs where shop_id=s and article='sku-671');
  assert public.save_cost_prices(s,rows)=477,'repeated upload is idempotent';
  begin
    perform public.save_cost_prices(s,'[{"article":"sku-1","cost_price":-1},{"article":"SKU-1","cost_price":1}]');
  exception when raise_exception then failed:=true;
  end;
  assert failed,'invalid earlier duplicate cannot be hidden by a valid later row';
  assert (select min(cost_price)=4.78 from public.sku_costs where shop_id=s and lower(article)='sku-1');
  assert public.save_cost_prices(s,'[]')=0;
  perform public.save_cost_prices(s,'[{"article":"new-item","name":"New","cost_price":12.34}]');
  assert (select cost_price=12.34 from public.sku_costs where shop_id=s and article='new-item');
end;
$$;
select set_config('request.jwt.claim.sub',current_setting('test.member_id'),true);
do $$ begin
  assert public.save_cost_prices(current_setting('test.shop_id')::uuid,
    '[{"article":"new-item","cost_price":14.5}]')=1,'members retain write access';
end; $$;
select set_config('request.jwt.claim.sub',current_setting('test.outsider_id'),true);
do $$
declare denied boolean:=false;
begin
  begin
    perform public.save_cost_prices(current_setting('test.shop_id')::uuid,
      '[{"article":"new-item","cost_price":1}]');
  exception when insufficient_privilege then denied:=true;
  end;
  assert denied,'public viewing must never grant price editing';
end;
$$;
reset role;
do $$ begin
  assert (select cost_price=14.5 from public.sku_costs
    where shop_id=current_setting('test.shop_id')::uuid and article='new-item');
  assert (select cost_price=999 from public.sku_costs
    where shop_id=current_setting('test.other_shop_id')::uuid and article='sku-1');
  assert not (select prosecdef from pg_proc where oid='public.save_cost_prices(uuid,jsonb)'::regprocedure);
  assert not has_function_privilege('anon','public.save_cost_prices(uuid,jsonb)','execute');
end; $$;
select 'PASS: 690-row atomic import, 477 articles, aliases, decimals, names, repeat upload, member access and cross-shop RLS' as result;
rollback;
