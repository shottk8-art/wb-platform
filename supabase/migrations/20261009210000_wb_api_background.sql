-- Durable scheduler: no user session, browser tab or plaintext global secret.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
alter table public.wb_api_preview_jobs
  add column row_count bigint not null default 0,
  add column failure_count integer not null default 0,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column lease_used_at timestamptz;
update public.wb_api_preview_jobs j set row_count = (select count(*) from public.wb_api_preview_rows r where r.job_id=j.id);
create unique index wb_api_one_loading_period on public.wb_api_preview_jobs(shop_id,date_from,date_to) where status='loading';

create function public.wb_api_accept_lease(p_job_id uuid, p_lease uuid)
returns setof public.wb_api_preview_jobs
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  return query update public.wb_api_preview_jobs j set lease_used_at=now()
    where j.id=p_job_id and j.lease_token=p_lease and j.lease_until>now()
      and j.lease_used_at is null and j.status='loading'
      and exists(select 1 from public.shops s where s.id=j.shop_id
        and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid)
    returning j.*;
end; $$;

create function public.wb_api_dispatch(p_url text)
returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; chosen record; capability uuid; dispatched integer:=0;
begin
  -- Serialized dispatch prevents two cron/manual ticks issuing parallel pages.
  if not pg_try_advisory_xact_lock(hashtextextended('wb-api-dispatch',0)) then return 0; end if;
  for candidate in
    select c.shop_id from public.wb_api_connections c join public.shops s on s.id=c.shop_id
      where s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid
        and c.next_request_at<=now()
        and exists(select 1 from public.wb_api_preview_jobs j where j.shop_id=c.shop_id and j.status='loading')
        and not exists(select 1 from public.wb_api_preview_jobs j where j.shop_id=c.shop_id and j.lease_until>now())
      limit 4
  loop
    select j.id into chosen from public.wb_api_preview_jobs j
      where j.shop_id=candidate.shop_id and j.status='loading'
      order by j.created_at limit 1 for update skip locked;
    if not found then continue; end if;
    capability:=gen_random_uuid();
    update public.wb_api_preview_jobs set lease_token=capability, lease_until=now()+interval '10 minutes',lease_used_at=null where id=chosen.id;
    perform net.http_post(url:=p_url,
      headers:=jsonb_build_object('Content-Type','application/json','X-WB-Worker-Lease',capability::text),
      body:=jsonb_build_object('job_id',chosen.id), timeout_milliseconds:=120000);
    dispatched:=dispatched+1;
  end loop;
  return dispatched;
end; $$;
revoke all on function public.wb_api_accept_lease(uuid,uuid), public.wb_api_dispatch(text) from public,anon,authenticated;
grant execute on function public.wb_api_accept_lease(uuid,uuid), public.wb_api_dispatch(text) to service_role;

select cron.schedule('wb-api-background','* * * * *',
  $cron$select public.wb_api_dispatch('https://qhvrdqcixglxopwrzeha.supabase.co/functions/v1/wb-api');$cron$);
-- Enable only after the matching authenticated worker has been deployed.
select cron.alter_job((select jobid from cron.job where jobname='wb-api-background'),active:=false);
