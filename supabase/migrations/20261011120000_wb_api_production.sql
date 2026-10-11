-- Production rollout: per-shop credentials, queue and leases. No client role
-- gains table/Vault/RPC access. Browser authorization remains in the function.
alter table public.wb_api_connections add column if not exists history_queued_at timestamptz;
create index if not exists wb_api_jobs_month_idx on public.wb_api_preview_jobs(shop_id,date_from,created_at desc);
create index if not exists wb_api_ready_connections_idx on public.wb_api_connections(next_request_at,shop_id);

create or replace function public.wb_api_queue_month(p_shop_id uuid,p_month date,p_refresh boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare today date:=(now() at time zone 'Europe/Moscow')::date;
  current_month date:=date_trunc('month',today)::date; finish date; existing record; result uuid;
begin
  if not exists(select 1 from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.id=p_shop_id and (c.expires_at is null or c.expires_at>now())) then raise exception 'Not connected'; end if;
  if p_month is null or p_month<>date_trunc('month',p_month)::date
    or p_month<current_month-interval '11 months' or p_month>current_month then raise exception 'Invalid month'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wb-api-month:'||p_shop_id::text||p_month::text,0));
  finish:=least(today,(p_month+interval '1 month - 1 day')::date);
  select id,status into existing from public.wb_api_preview_jobs
    where shop_id=p_shop_id and date_from=p_month and status='loading' order by created_at desc limit 1;
  if found then
    if p_refresh then update public.wb_api_preview_jobs set summary=jsonb_set(summary,'{pilot,priority}','100'::jsonb) where id=existing.id; end if;
    return existing.id;
  end if;
  select id,status into existing from public.wb_api_preview_jobs
    where shop_id=p_shop_id and date_from=p_month and date_to=finish order by created_at desc limit 1;
  -- Errors require explicit retry; the scheduler must not hammer WB.
  if found and not p_refresh then return existing.id; end if;
  insert into public.wb_api_preview_jobs(shop_id,date_from,date_to,summary)
    values(p_shop_id,p_month,finish,jsonb_build_object('pilot',jsonb_build_object('version',2,'stage','finance','orders_offset',0,
      'priority',case when p_refresh then 100 else 0 end,'finance_period',case when p_month=current_month then 'daily' else 'weekly' end),'api_sources','{}'::jsonb))
    returning id into result;
  return result;
end; $$;

create or replace function public.wb_api_queue_shop_history(p_shop_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare current_month date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date; i integer;
begin
  perform 1 from public.wb_api_connections c where c.shop_id=p_shop_id
    and (c.expires_at is null or c.expires_at>now()) for update;
  if not found then return 0; end if;
  for i in 0..11 loop
    perform public.wb_api_queue_month(p_shop_id,(current_month-i*interval '1 month')::date,false);
  end loop;
  update public.wb_api_connections set history_queued_at=now() where shop_id=p_shop_id;
  return 12;
end; $$;

create or replace function public.wb_api_queue_history()
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; queued integer:=0;
begin
  -- Reconcile bounded batches hourly per shop, not twelve month queries per
  -- shop on every one-minute worker tick. Connect queues its own shop at once.
  for candidate in select c.shop_id from public.wb_api_connections c
    where (c.expires_at is null or c.expires_at>now())
      and (c.history_queued_at is null or c.history_queued_at<now()-interval '1 hour')
    order by c.history_queued_at nulls first,c.shop_id limit 10 for update skip locked
  loop
    queued:=queued+public.wb_api_queue_shop_history(candidate.shop_id);
  end loop;
  return queued;
end; $$;

create or replace function public.wb_api_accept_lease(p_job_id uuid,p_lease uuid)
returns setof public.wb_api_preview_jobs language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  return query update public.wb_api_preview_jobs j set lease_used_at=now()
    where j.id=p_job_id and j.lease_token=p_lease and j.lease_until>now()
      and j.lease_used_at is null and j.status='loading'
      and exists(select 1 from public.wb_api_connections c join public.shops s on s.id=c.shop_id
        where c.shop_id=j.shop_id and (c.expires_at is null or c.expires_at>now()))
    returning j.*;
end; $$;

create or replace function public.wb_api_dispatch(p_url text)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; chosen record; capability uuid; dispatched integer:=0;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('wb-api-dispatch',0)) then return 0; end if;
  perform public.wb_api_queue_history();
  for candidate in
    select c.shop_id from public.wb_api_connections c join public.shops s on s.id=c.shop_id
      where c.next_request_at<=now() and (c.expires_at is null or c.expires_at>now())
        and exists(select 1 from public.wb_api_preview_jobs j where j.shop_id=c.shop_id and j.status='loading')
        and not exists(select 1 from public.wb_api_preview_jobs j where j.shop_id=c.shop_id and j.lease_until>now())
      order by c.next_request_at,c.shop_id limit 4
  loop
    select j.id into chosen from public.wb_api_preview_jobs j where j.shop_id=candidate.shop_id and j.status='loading'
      order by case when j.summary->'pilot'->>'priority'='100' then 1 else 0 end desc,j.date_from desc,j.created_at
      limit 1 for update skip locked;
    if not found then continue; end if;
    capability:=gen_random_uuid();
    update public.wb_api_preview_jobs set lease_token=capability,lease_until=now()+interval '10 minutes',lease_used_at=null where id=chosen.id;
    perform net.http_post(url:=p_url,headers:=jsonb_build_object('Content-Type','application/json','X-WB-Worker-Lease',capability::text),
      body:=jsonb_build_object('job_id',chosen.id),timeout_milliseconds:=120000);
    dispatched:=dispatched+1;
  end loop;
  return dispatched;
end; $$;

revoke all on function public.wb_api_queue_month(uuid,date,boolean),public.wb_api_queue_shop_history(uuid),public.wb_api_queue_history(),public.wb_api_accept_lease(uuid,uuid),public.wb_api_dispatch(text) from public,anon,authenticated;
grant execute on function public.wb_api_queue_month(uuid,date,boolean),public.wb_api_queue_shop_history(uuid),public.wb_api_queue_history(),public.wb_api_accept_lease(uuid,uuid),public.wb_api_dispatch(text) to service_role;
