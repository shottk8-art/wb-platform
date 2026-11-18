-- Transaction-only checks. Never call the dispatcher or WB.
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare first_id uuid; second_id uuid; capability uuid:=gen_random_uuid(); before_members integer; count_rows integer;
  model jsonb:='{"version":1,"row_count":1,"covered_rows":1,"unallocated_rows":0,"cursor_id":"1","buckets":[]}';
begin
  first_id:=public.wb_promo_queue_month(date_trunc('month',now() at time zone 'Europe/Moscow')::date,false);
  second_id:=public.wb_promo_queue_month(date_trunc('month',now() at time zone 'Europe/Moscow')::date,false);
  if first_id<>second_id then raise exception 'Duplicate period work'; end if;
  update public.wb_promo_jobs set lease_token=capability,lease_until=now()+interval '10 minutes' where id=first_id;
  select count(*) into count_rows from public.wb_promo_accept_lease(first_id,capability);
  if count_rows<>1 then raise exception 'Lease not accepted'; end if;
  select count(*) into count_rows from public.wb_promo_accept_lease(first_id,capability);
  if count_rows<>0 then raise exception 'Lease replay'; end if;
  if not public.wb_promo_commit_page(first_id,capability,'0',0,model,false) then raise exception 'Page commit failed'; end if;
  if public.wb_promo_commit_page(first_id,capability,'0',0,model,false) then raise exception 'Stale cursor replay'; end if;
  if not public.wb_promo_commit_page(first_id,capability,'1',1,model,true) then raise exception 'Final empty page failed'; end if;
  if public.wb_promo_queue_month(date_trunc('month',now() at time zone 'Europe/Moscow')::date,true)<>first_id then raise exception 'Fresh result fetched twice'; end if;
  select count(*) into before_members from public.shop_members;
  insert into public.wb_promo_viewers(shop_id,telegram_username) values('853b81a0-e0e2-4195-bc80-1cdc362af946','promo_test_only');
  if (select count(*) from public.shop_members)<>before_members then raise exception 'Invitation granted broad access'; end if;
  if has_table_privilege('anon','public.wb_promo_jobs','SELECT') or has_table_privilege('authenticated','public.wb_promo_names','SELECT') then raise exception 'Direct table access'; end if;
  if has_function_privilege('authenticated','public.wb_promo_accept_lease(uuid,uuid)','EXECUTE') or has_function_privilege('anon','public.wb_promo_dispatch()','EXECUTE') then raise exception 'Public worker access'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin
    perform public.wb_promo_queue_month(date_trunc('month',now() at time zone 'Europe/Moscow')::date,false);
    raise exception 'Role guard did not run';
  exception when raise_exception then if sqlerrm<>'Forbidden' then raise; end if; end;
end; $$;
