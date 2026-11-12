-- Always rollback. No HTTP dispatch and no persistent user-preference changes.
begin;
set local statement_timeout='8s';
do $$
declare a uuid; b uuid; outsider uuid; capability uuid:=gen_random_uuid(); accepted integer; rejected boolean:=false;
  marker text:='9999999999999999903'; before_a jsonb; before_b jsonb;
begin
  select s.id into a from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261' order by s.id limit 1;
  select s.id into b from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261' and s.id<>a order by s.id limit 1;
  select s.id into outsider from public.shops s where s.owner_id<>'bbb002c4-cd7a-490d-b9c0-72aed5424261' limit 1;
  assert a is not null and b is not null and outsider is not null;
  foreach a in array array[a,b] loop
    assert not has_table_privilege('authenticated','public.wb_stock_snapshots','SELECT');
    assert not has_table_privilege('anon','public.wb_stock_tracking','SELECT');
    perform set_config('request.jwt.claim.role','service_role',true);
    perform public.wb_stock_enqueue(a);
    update public.wb_stock_snapshots set stage='wb',lease_token=capability,lease_until=now()+interval '1 minute',lease_used_at=null where shop_id=a;
    select count(*) into accepted from public.wb_stock_accept_lease(a,capability);assert accepted=1;
    select count(*) into accepted from public.wb_stock_accept_lease(a,capability);assert accepted=0,'worker lease is single-use for each shop';
    assert public.wb_api_queue_recent_unit(a)=0,'migration has already queued or reused both recent months';
  end loop;
  -- a is now b after the loop; obtain the other owner shop again.
  select s.id into a from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261' and s.id<>b order by s.id limit 1;
  select excluded_products into before_b from public.wb_stock_tracking where shop_id=b;
  select excluded_products into before_a from public.wb_stock_tracking where shop_id=a;
  perform public.wb_stock_set_tracking(a,marker,true);
  assert (select excluded_products ? marker from public.wb_stock_tracking where shop_id=a);
  assert (select excluded_products from public.wb_stock_tracking where shop_id=b) is not distinct from before_b,'preferences never cross shops';
  perform public.wb_stock_set_tracking(a,marker,false);
  assert (select excluded_products from public.wb_stock_tracking where shop_id=a)=coalesce(before_a,'{}'::jsonb);
  begin perform public.wb_stock_enqueue(outsider);exception when others then rejected:=true;end;
  assert rejected,'a service caller still cannot enqueue a foreign owner shop';rejected:=false;
  begin perform public.wb_stock_set_tracking(outsider,marker,true);exception when others then rejected:=true;end;
  assert rejected;assert public.wb_api_queue_recent_unit(outsider)=0;
  assert not has_function_privilege('authenticated','public.wb_stock_enqueue(uuid)','EXECUTE');
  assert not has_function_privilege('anon','public.wb_api_queue_recent_unit(uuid)','EXECUTE');
  assert not exists(select 1 from public.wb_stock_snapshots x join public.shops s on s.id=x.shop_id where s.owner_id<>'bbb002c4-cd7a-490d-b9c0-72aed5424261');
end; $$;
rollback;
