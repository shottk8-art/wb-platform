-- Private TOPLASH pilot. One current snapshot only; no raw order history.
create table public.wb_stock_snapshots (
  shop_id uuid primary key references public.wb_api_connections(shop_id) on delete cascade,
  snapshot jsonb, fetched_at timestamptz,
  stage text not null default 'idle' check(stage in ('idle','wb','seller','demand')),
  pending jsonb not null default '{}', page_offset integer not null default 0 check(page_offset>=0),
  next_run_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  error_message text, failure_count integer not null default 0,
  lease_token uuid, lease_until timestamptz, lease_used_at timestamptz,
  alert_days integer not null default 14 check(alert_days between 1 and 180),
  target_days integer not null default 30 check(target_days between alert_days and 365),
  check(shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid)
);
alter table public.wb_stock_snapshots enable row level security;
revoke all on public.wb_stock_snapshots from public,anon,authenticated;
grant all on public.wb_stock_snapshots to service_role;

create function public.wb_stock_enqueue(p_shop_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' or p_shop_id<>'853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid then raise exception 'Forbidden'; end if;
  if not exists(select 1 from public.shops s join public.wb_api_connections c on c.shop_id=s.id where s.id=p_shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid) then raise exception 'Forbidden'; end if;
  insert into public.wb_stock_snapshots(shop_id) values(p_shop_id) on conflict do nothing;
  update public.wb_stock_snapshots set stage='wb',pending='{}',page_offset=0,error_message=null,failure_count=0,next_run_at=now(),updated_at=now()
    where shop_id=p_shop_id and stage='idle' and (lease_until is null or lease_until<now())
      and (fetched_at is null or fetched_at<now()-interval '30 minutes' or (error_message is not null and updated_at<now()-interval '1 minute'));
end; $$;

create function public.wb_stock_accept_lease(p_shop_id uuid,p_lease uuid)
returns setof public.wb_stock_snapshots
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  return query update public.wb_stock_snapshots x set lease_used_at=now()
    where x.shop_id=p_shop_id and x.shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid
      and x.lease_token=p_lease and x.lease_until>now() and x.lease_used_at is null and x.stage<>'idle'
      and exists(select 1 from public.shops s where s.id=x.shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid)
    returning x.*;
end; $$;

create function public.wb_stock_dispatch() returns integer
language plpgsql security definer set search_path='' as $$
declare x record; capability uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('wb-stock-pilot',0)) then return 0; end if;
  insert into public.wb_stock_snapshots(shop_id)
    select s.id from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.id='853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid on conflict do nothing;
  select a.* into x from public.wb_stock_snapshots a join public.shops s on s.id=a.shop_id
    where a.shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid
      and a.next_run_at<=now() and (a.lease_until is null or a.lease_until<now()) for update of a skip locked;
  if not found then return 0; end if;
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
  return 1;
end; $$;
revoke all on function public.wb_stock_enqueue(uuid),public.wb_stock_accept_lease(uuid,uuid),public.wb_stock_dispatch() from public,anon,authenticated;
grant execute on function public.wb_stock_enqueue(uuid),public.wb_stock_accept_lease(uuid,uuid),public.wb_stock_dispatch() to service_role;
select cron.schedule('wb-stock-pilot','* * * * *','select public.wb_stock_dispatch();');
select cron.alter_job((select jobid from cron.job where jobname='wb-stock-pilot'),active:=false);
