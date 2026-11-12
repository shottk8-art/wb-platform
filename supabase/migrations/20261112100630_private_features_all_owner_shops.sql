-- Private experiments follow the immutable account, not a single shop.
-- No browser/table grants change; the Edge handler also retains authorizeShop.
alter table public.wb_stock_snapshots drop constraint wb_stock_snapshots_shop_id_check;
alter table public.wb_stock_tracking drop constraint wb_stock_tracking_shop_id_check;

create or replace function public.wb_stock_enqueue(p_shop_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if not exists(select 1 from public.shops s join public.wb_api_connections c on c.shop_id=s.id where s.id=p_shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid) then raise exception 'Forbidden'; end if;
  insert into public.wb_stock_snapshots(shop_id) values(p_shop_id) on conflict do nothing;
  update public.wb_stock_snapshots set stage='wb',pending='{}',page_offset=0,error_message=null,failure_count=0,next_run_at=now(),updated_at=now()
    where shop_id=p_shop_id and stage='idle' and (lease_until is null or lease_until<now())
      and (fetched_at is null or fetched_at<now()-interval '30 minutes' or (error_message is not null and updated_at<now()-interval '1 minute'));
end; $$;

create or replace function public.wb_stock_accept_lease(p_shop_id uuid,p_lease uuid)
returns setof public.wb_stock_snapshots
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  return query update public.wb_stock_snapshots x set lease_used_at=now()
    where x.shop_id=p_shop_id
      and x.lease_token=p_lease and x.lease_until>now() and x.lease_used_at is null and x.stage<>'idle'
      and exists(select 1 from public.shops s where s.id=x.shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid)
    returning x.*;
end; $$;


create or replace function public.wb_stock_set_tracking(p_shop_id uuid,p_nm_id text,p_excluded boolean)
returns void language plpgsql security definer set search_path='' as $$
declare old jsonb; item jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if p_nm_id is null or p_nm_id!~'^[1-9][0-9]{0,19}$' or p_excluded is null then raise exception 'Invalid product'; end if;
  if not exists(select 1 from public.shops where id=p_shop_id and owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid) then raise exception 'Forbidden'; end if;
  insert into public.wb_stock_tracking(shop_id) values(p_shop_id) on conflict do nothing;
  select excluded_products into old from public.wb_stock_tracking where shop_id=p_shop_id for update;
  if p_excluded then
    if old ? p_nm_id then return; end if;
    if (select count(*) from jsonb_object_keys(old))>=10000 then raise exception 'Tracking limit'; end if;
    select p into item from public.wb_stock_snapshots s cross join lateral jsonb_array_elements(s.snapshot->'catalogue') p
      where s.shop_id=p_shop_id and p->>'nm_id'=p_nm_id limit 1;
    -- Preserve a small identity even if WB later removes a retired card. No
    -- source quantities or order history are copied into these preferences.
    item:=jsonb_build_object('nm_id',p_nm_id,'article',coalesce(item->>'article',p_nm_id),
      'name',coalesce(item->>'name','Артикул WB '||p_nm_id),'excluded_at',now());
    update public.wb_stock_tracking set excluded_products=jsonb_set(excluded_products,array[p_nm_id],item),updated_at=now() where shop_id=p_shop_id;
  else
    update public.wb_stock_tracking set excluded_products=excluded_products-p_nm_id,updated_at=now() where shop_id=p_shop_id;
  end if;
end; $$;
revoke all on function public.wb_stock_set_tracking(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.wb_stock_set_tracking(uuid,text,boolean) to service_role;

-- Bounded parallelism across independent shops; oldest due work runs first.
create or replace function public.wb_stock_dispatch() returns integer
language plpgsql security definer set search_path='' as $$
declare x record; capability uuid; dispatched integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('wb-stock-pilot',0)) then return 0; end if;
  insert into public.wb_stock_snapshots(shop_id)
    select s.id from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid
      and (c.expires_at is null or c.expires_at>now()) on conflict do nothing;
  for x in select a.* from public.wb_stock_snapshots a
    join public.shops s on s.id=a.shop_id join public.wb_api_connections c on c.shop_id=s.id
    where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid
      and (c.expires_at is null or c.expires_at>now())
      and a.next_run_at<=now() and (a.lease_until is null or a.lease_until<now())
    order by a.next_run_at,a.shop_id limit 8 for update of a skip locked
  loop
    capability:=gen_random_uuid();
    update public.wb_stock_snapshots set
      stage=case when stage='idle' then 'wb' else stage end,
      pending=case when stage='idle' then '{}'::jsonb else pending end,
      page_offset=case when stage='idle' then 0 else page_offset end,
      lease_token=capability,lease_until=now()+interval '3 minutes',lease_used_at=null
      where shop_id=x.shop_id;
    perform net.http_post(url:='https://qhvrdqcixglxopwrzeha.supabase.co/functions/v1/wb-api',
      headers:=jsonb_build_object('Content-Type','application/json','X-WB-Stock-Lease',capability::text),
      body:=jsonb_build_object('shop_id',x.shop_id),timeout_milliseconds:=60000);
    dispatched:=dispatched+1;
  end loop;
  return dispatched;
end; $$;
revoke all on function public.wb_stock_dispatch() from public,anon,authenticated;
grant execute on function public.wb_stock_dispatch() to service_role;

create or replace function public.wb_api_queue_recent_unit(p_shop_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare current_month date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;
  month_start date; latest record; queued integer:=0; i integer;
begin
  if not exists(select 1 from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.id=p_shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid
      and (c.expires_at is null or c.expires_at>now())) then return 0; end if;
  for i in 0..1 loop
    month_start:=(current_month-i*interval '1 month')::date;
    perform pg_advisory_xact_lock(hashtextextended('wb-api-month:'||p_shop_id::text||month_start::text,0));
    select j.* into latest from public.wb_api_preview_jobs j
      where j.shop_id=p_shop_id and j.date_from=month_start order by j.created_at desc limit 1;
    if found and latest.status in ('loading','error') then continue; end if;
    if found and latest.status='complete' and latest.finance_model->'unit'->>'version'='1'
      and latest.finance_model->'unit'->>'row_count'=latest.row_count::text
      and latest.finance_model->'unit'->>'cursor_id'=latest.cursor_id::text
      and latest.finance_model->'daily'->>'version'='1'
      and latest.finance_model->'daily'->>'row_count'=latest.row_count::text then
      if latest.summary->'api_sources'->'article_ads'->>'status'='downloaded'
        and latest.summary->'api_sources'->'article_ads'->>'version'='1' then continue; end if;
      -- An ads-only snapshot reuses compact finance and orders. The last ready
      -- snapshot stays readable while the existing leased worker collects ads.
      insert into public.wb_api_preview_jobs(shop_id,date_from,date_to,cursor_id,row_count,finance_model,summary)
        values(p_shop_id,latest.date_from,latest.date_to,latest.cursor_id,latest.row_count,latest.finance_model,
          jsonb_set(jsonb_set(latest.summary,'{pilot,stage}','"article_ads_debits"'::jsonb),'{pilot,priority}','100'::jsonb));
    else
      perform public.wb_api_queue_month(p_shop_id,month_start,true);
    end if;
    queued:=queued+1;
  end loop;
  return queued;
end; $$;
revoke all on function public.wb_api_queue_recent_unit(uuid) from public,anon,authenticated;
grant execute on function public.wb_api_queue_recent_unit(uuid) to service_role;

-- Prepare only two recent months, once. Existing active/ready jobs are reused;
-- the existing hourly reconciler handles future shops/month changes.
select public.wb_api_queue_recent_unit(s.id)
  from public.shops s join public.wb_api_connections c on c.shop_id=s.id
  where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid;
