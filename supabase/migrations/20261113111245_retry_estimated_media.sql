-- Retry only unavailable Media; preserve finance, orders, ads and the labelled
-- zero used in calculations while the worker checks again. No client access.
create index if not exists wb_api_media_estimates_idx
  on public.wb_api_preview_jobs(updated_at)
  where status='complete' and summary#>>'{api_sources,media,estimated}'='true';

create or replace function public.wb_api_retry_media_estimates()
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  with candidates as (
    select j.id from public.wb_api_preview_jobs j
    join public.wb_api_connections c on c.shop_id=j.shop_id
    where j.status='complete' and j.summary#>>'{api_sources,media,estimated}'='true'
      and j.updated_at<now()-interval '6 hours'
      and (c.expires_at is null or c.expires_at>now())
      and j.date_from>=date_trunc('month',now() at time zone 'Europe/Moscow')::date-interval '11 months'
      and not exists(select 1 from public.wb_api_preview_jobs newer where newer.shop_id=j.shop_id and newer.date_from=j.date_from and newer.status='complete' and newer.created_at>j.created_at)
      and not exists(select 1 from public.wb_api_preview_jobs active where active.shop_id=j.shop_id and active.date_from=j.date_from and active.status='loading')
    order by j.updated_at,j.id limit 20 for update of j skip locked
  )
  update public.wb_api_preview_jobs j set status='loading',failure_count=0,error_message=null,
    summary=jsonb_set(j.summary,'{pilot,stage}',to_jsonb(case when j.summary#>>'{api_sources,media,retry_stage}'='media_stats' then 'media_stats'::text else 'media_list'::text end)),
    updated_at=now()
  from candidates c where j.id=c.id;
  get diagnostics changed=row_count;
  return changed;
end; $$;
revoke all on function public.wb_api_retry_media_estimates() from public,anon,authenticated;
grant execute on function public.wb_api_retry_media_estimates() to service_role;
select cron.schedule('wb-api-media-estimate-retry','*/15 * * * *','select public.wb_api_retry_media_estimates();');
