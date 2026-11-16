-- Run in a transaction and roll back. Never dispatch a worker or contact WB.
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare a uuid; b uuid; waiting integer; deadline timestamptz; other_deadline timestamptz;
begin
  select shop_id into a from public.wb_api_connections order by shop_id limit 1;
  select shop_id into b from public.wb_api_connections where shop_id<>a order by shop_id limit 1;
  if a is null or b is null then raise exception 'Two connected fixtures required'; end if;
  select next_request_at into other_deadline from public.wb_api_connections where shop_id=b;
  update public.wb_api_connections set next_analytics_at='-infinity',upstream_blocked_until='-infinity',next_request_at=now()+interval '1 hour' where shop_id=a;
  -- Ordinary finance pacing must not starve inventory's independent endpoint.
  if public.wb_api_claim_analytics(a)<>0 then raise exception 'Finance blocked analytics'; end if;
  waiting:=public.wb_api_claim_analytics(a);
  if waiting not between 20 and 21 then raise exception 'Analytics burst collision not delayed'; end if;
  perform public.wb_api_defer_request(a,43109,true);
  if public.wb_api_claim_analytics(a)<43109 then raise exception 'Analytics lost Retry'; end if;
  if public.wb_api_claim_request(a,'finance')<43109 then raise exception 'Finance lost Retry'; end if;
  select next_request_at into deadline from public.wb_api_connections where shop_id=a;
  perform public.wb_api_defer_request(a,63,true);
  if (select next_request_at from public.wb_api_connections where shop_id=a)<>deadline then raise exception 'Shorter concurrent delay overwrote Retry'; end if;
  if (select next_request_at from public.wb_api_connections where shop_id=b) is distinct from other_deadline then raise exception 'Cross-shop cooldown'; end if;
  update public.wb_api_connections set upstream_blocked_until='-infinity',next_analytics_at='-infinity' where shop_id=a;
  perform public.wb_api_defer_request(a,240,false);
  if public.wb_api_claim_analytics(a)<>0 then raise exception 'Non-rate-limit error blocked analytics'; end if;
  if has_function_privilege('anon','public.wb_api_defer_request(uuid,integer,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.wb_api_claim_analytics(uuid)','EXECUTE') then raise exception 'Public worker access'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.wb_api_claim_analytics(a);
    raise exception 'Role guard did not run';
  exception when raise_exception then
    if sqlerrm<>'Forbidden' then raise; end if;
  end;
end; $$;
