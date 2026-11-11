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
    select j.* into latest from public.wb_api_preview_jobs j
      where j.shop_id=p_shop_id and j.date_from=month_start order by j.created_at desc limit 1;
    if found and latest.status in ('loading','error') then continue; end if;
    if found and latest.status='complete' and latest.finance_model->'unit'->>'version'='1'
      and latest.finance_model->'unit'->>'row_count'=latest.row_count::text
      and latest.finance_model->'unit'->>'cursor_id'=latest.cursor_id::text then
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
