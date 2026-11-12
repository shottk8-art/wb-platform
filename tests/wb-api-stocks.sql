-- Security integration test; every fixture modification is rolled back.
begin;
do $$
declare capability uuid:=gen_random_uuid(); accepted integer;
begin
  assert not has_table_privilege('authenticated','public.wb_stock_snapshots','SELECT');
  assert not has_table_privilege('anon','public.wb_stock_snapshots','SELECT');
  assert not has_function_privilege('authenticated','public.wb_stock_accept_lease(uuid,uuid)','EXECUTE');
  assert (select relrowsecurity from pg_class where oid='public.wb_stock_snapshots'::regclass);
  assert exists(select 1 from public.wb_stock_snapshots where shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946');
  update public.wb_stock_snapshots set stage='wb',lease_token=capability,lease_until=now()+interval '1 minute',lease_used_at=null
    where shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946';
  perform set_config('request.jwt.claim.role','service_role',true);
  select count(*) into accepted from public.wb_stock_accept_lease('853b81a0-e0e2-4195-bc80-1cdc362af946',capability);
  assert accepted=1,'a valid private worker capability is accepted once';
  select count(*) into accepted from public.wb_stock_accept_lease('853b81a0-e0e2-4195-bc80-1cdc362af946',capability);
  assert accepted=0,'a capability cannot be replayed';
  select count(*) into accepted from public.wb_stock_accept_lease('00000000-0000-0000-0000-000000000001',capability);
  assert accepted=0,'a capability cannot cross shops';
end; $$;
rollback;
