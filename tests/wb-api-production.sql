-- Run after the production migration. Transaction rollback leaves no fixtures,
-- keys, users, jobs or live queue changes. No WB/Vault/network calls are made.
begin;
do $$
declare owner_a uuid; owner_b uuid; shop_a uuid:=gen_random_uuid(); shop_b uuid:=gen_random_uuid();
  expired_shop uuid:=gen_random_uuid(); month date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;
  job_a uuid; job_b uuid; lease uuid:=gen_random_uuid(); n integer;
begin
  select owner_id into owner_a from public.shops order by created_at limit 1;
  select id into owner_b from auth.users where id<>owner_a order by created_at limit 1;
  if owner_a is null or owner_b is null then raise exception 'Two existing owners required for isolation test'; end if;
  insert into public.shops(id,owner_id,name,slug) values
    (shop_a,owner_a,'__api_release_a__',shop_a::text),
    (shop_b,owner_b,'__api_release_b__',shop_b::text),
    (expired_shop,owner_b,'__api_release_expired__',expired_shop::text);
  insert into public.wb_api_connections(shop_id,secret_id,seller_id,seller_name,expires_at) values
    (shop_a,gen_random_uuid(),shop_a::text,'fixture',now()+interval '1 day'),
    (shop_b,gen_random_uuid(),shop_b::text,'fixture',now()+interval '1 day'),
    (expired_shop,gen_random_uuid(),expired_shop::text,'fixture',now()-interval '1 day');
  if public.wb_api_queue_shop_history(shop_a)<>12 or public.wb_api_queue_shop_history(shop_b)<>12
    or public.wb_api_queue_shop_history(expired_shop)<>0 then raise exception 'History isolation failed'; end if;
  perform public.wb_api_queue_shop_history(shop_a);
  select count(*) into n from public.wb_api_preview_jobs where shop_id=shop_a;
  if n<>12 then raise exception 'History is not idempotent'; end if;
  select count(*) into n from public.wb_api_preview_jobs where shop_id=shop_b;
  if n<>12 then raise exception 'Second owner history missing'; end if;
  if exists(select 1 from public.wb_api_preview_jobs where shop_id=expired_shop) then raise exception 'Expired connection queued'; end if;
  job_a:=public.wb_api_queue_month(shop_a,month,false);
  job_b:=public.wb_api_queue_month(shop_b,month,false);
  if job_a=job_b or job_a<>public.wb_api_queue_month(shop_a,month,true) then raise exception 'Monthly queues mixed or duplicated'; end if;
  update public.wb_api_preview_jobs set lease_token=lease,lease_until=now()+interval '10 minutes',lease_used_at=null where id=job_a;
  perform set_config('request.jwt.claim.role','service_role',true);
  select count(*) into n from public.wb_api_accept_lease(job_b,lease);
  if n<>0 then raise exception 'Lease crossed shops'; end if;
  select count(*) into n from public.wb_api_accept_lease(job_a,lease);
  if n<>1 then raise exception 'Own lease rejected'; end if;
  select count(*) into n from public.wb_api_accept_lease(job_a,lease);
  if n<>0 then raise exception 'Lease reused'; end if;
  if has_table_privilege('authenticated','public.wb_api_connections','SELECT')
    or has_table_privilege('anon','public.wb_api_preview_jobs','SELECT')
    or has_function_privilege('authenticated','public.wb_api_queue_shop_history(uuid)','EXECUTE')
    or has_function_privilege('anon','public.wb_api_accept_lease(uuid,uuid)','EXECUTE') then raise exception 'Client privilege leak'; end if;
end; $$;
select 'PASS: two owners, isolated/idempotent 12-month queues, expired keys excluded, single-use scoped leases, private privileges; fixtures rolled back' as result;
rollback;
