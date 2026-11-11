-- Use the existing hourly history reconciliation and durable WB worker.
-- Backfill only the exact private pilot's current and preceding months.
create or replace function public.wb_api_queue_recent_unit(p_shop_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare current_month date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;
  month_start date; latest record; queued integer:=0; i integer;
begin
  if p_shop_id is distinct from '853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid then return 0; end if;
  if not exists(select 1 from public.shops s join public.wb_api_connections c on c.shop_id=s.id
    where s.id=p_shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid
      and (c.expires_at is null or c.expires_at>now())) then return 0; end if;
  for i in 0..1 loop
    month_start:=(current_month-i*interval '1 month')::date;
    perform pg_advisory_xact_lock(hashtextextended('wb-api-month:'||p_shop_id::text||month_start::text,0));
    select j.id,j.status,j.row_count,j.cursor_id,j.finance_model->'unit'->>'version' as unit_version,
      j.finance_model->'unit'->>'row_count' as unit_rows,j.finance_model->'unit'->>'cursor_id' as unit_cursor
      into latest from public.wb_api_preview_jobs j
      where j.shop_id=p_shop_id and j.date_from=month_start order by j.created_at desc limit 1;
    -- An active job is already producing the compact unit model. Failed jobs
    -- retain the existing explicit-retry policy; never hammer WB on cron ticks.
    if found and (latest.status in ('loading','error') or (latest.status='complete'
      and latest.unit_version='1' and latest.unit_rows=latest.row_count::text
      and latest.unit_cursor=latest.cursor_id::text)) then continue; end if;
    perform public.wb_api_queue_month(p_shop_id,month_start,true);
    queued:=queued+1;
  end loop;
  return queued;
end; $$;
revoke all on function public.wb_api_queue_recent_unit(uuid) from public,anon,authenticated;
grant execute on function public.wb_api_queue_recent_unit(uuid) to service_role;

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
  perform public.wb_api_queue_recent_unit(p_shop_id);
  update public.wb_api_connections set history_queued_at=now() where shop_id=p_shop_id;
  return 12;
end; $$;
revoke all on function public.wb_api_queue_shop_history(uuid) from public,anon,authenticated;
grant execute on function public.wb_api_queue_shop_history(uuid) to service_role;
