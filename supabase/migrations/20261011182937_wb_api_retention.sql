set transaction read write;
-- Never delete a raw-backed legacy job. Keep two usable completed snapshots
-- per month, so a replacement can be published without losing the prior view.
create function public.wb_api_prune_snapshots(p_shop_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  with ranked as (
    select id,row_number() over(partition by date_from order by date_to desc,created_at desc,id desc) as rank
    from public.wb_api_preview_jobs where shop_id=p_shop_id and status='complete'
      and summary->'api_sources'->'orders'->>'status'='downloaded'
      and summary->'api_sources'->'internal_ads'->>'status'='downloaded'
      and summary->'api_sources'->'media'->>'status'='downloaded'
      and finance_model->>'cursor_id'=cursor_id::text
      and (finance_model->>'row_count')::bigint=row_count
  ), obsolete as (
    select j.id from public.wb_api_preview_jobs j join ranked r on r.id=j.id
    where r.rank>2 and j.finance_storage='aggregate'
      and not exists(select 1 from public.wb_api_preview_rows raw where raw.job_id=j.id)
    limit 200
  )
  delete from public.wb_api_preview_jobs where id in(select id from obsolete);
  get diagnostics affected=row_count;
  return affected;
end; $$;
create function public.wb_api_on_completed_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.wb_api_prune_snapshots(new.shop_id);
  return new;
end; $$;
create trigger wb_api_completed_retention after update of status on public.wb_api_preview_jobs
for each row when(new.status='complete' and old.status is distinct from 'complete')
execute function public.wb_api_on_completed_snapshot();

create function public.wb_api_housekeeping()
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  delete from cron.job_run_details where jobid in (
    select jobid from cron.job where jobname in ('wb-api-background','wb-api-housekeeping'))
    and coalesce(end_time,start_time)<now()-interval '7 days';
  get diagnostics affected=row_count;
  return affected;
end; $$;
revoke all on function public.wb_api_prune_snapshots(uuid),public.wb_api_on_completed_snapshot(),public.wb_api_housekeeping() from public,anon,authenticated;
grant execute on function public.wb_api_prune_snapshots(uuid),public.wb_api_housekeeping() to service_role;
select cron.schedule('wb-api-housekeeping','17 3 * * *','select public.wb_api_housekeeping();');
