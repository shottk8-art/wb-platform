begin;
do $$
declare tracked jsonb; first_id text:='9999999999999999901'; second_id text:='9999999999999999902';
begin
  assert not has_table_privilege('authenticated','public.wb_stock_tracking','SELECT');
  assert not has_table_privilege('anon','public.wb_stock_tracking','SELECT');
  assert not has_function_privilege('authenticated','public.wb_stock_set_tracking(uuid,text,boolean)','EXECUTE');
  assert (select relrowsecurity from pg_class where oid='public.wb_stock_tracking'::regclass);
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.wb_stock_set_tracking('853b81a0-e0e2-4195-bc80-1cdc362af946',first_id,true);
  perform public.wb_stock_set_tracking('853b81a0-e0e2-4195-bc80-1cdc362af946',first_id,true);
  perform public.wb_stock_set_tracking('853b81a0-e0e2-4195-bc80-1cdc362af946',second_id,true);
  select excluded_products into tracked from public.wb_stock_tracking where shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946';
  assert tracked ? first_id and tracked ? second_id,'updates preserve other exclusions';
  assert not (tracked->first_id ? 'quantity'),'preferences never copy source history';
  perform public.wb_stock_set_tracking('853b81a0-e0e2-4195-bc80-1cdc362af946',first_id,false);
  select excluded_products into tracked from public.wb_stock_tracking where shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946';
  assert not (tracked ? first_id) and tracked ? second_id,'restore removes only its own exclusion';
end; $$;
rollback;
