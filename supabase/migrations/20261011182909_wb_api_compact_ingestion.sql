-- Session-only override for quota recovery, never change global DB settings.
set transaction read write;

alter table public.wb_api_preview_jobs
  add column finance_storage text not null default 'legacy_rows'
  check (finance_storage in ('legacy_rows','aggregate'));

create function public.wb_api_commit_finance_page(
  p_job_id uuid,p_shop_id uuid,p_expected_cursor bigint,p_expected_rows bigint,
  p_cursor bigint,p_summary jsonb,p_model jsonb,p_status text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.wb_api_preview_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  select * into j from public.wb_api_preview_jobs where id=p_job_id and shop_id=p_shop_id for update;
  if not found then raise exception 'Snapshot not found'; end if;
  if j.status<>'loading' or j.cursor_id<>p_expected_cursor or j.row_count<>p_expected_rows
    or coalesce(j.summary->'pilot'->>'stage','finance')<>'finance' then return false; end if;
  if p_expected_cursor is null or p_expected_rows is null or p_cursor is null
    or p_status is null or p_status not in ('loading','complete') or p_cursor<j.cursor_id
    or p_model->>'version' is distinct from '1' or p_model->>'cursor_id' is distinct from p_cursor::text
    or (p_model->>'row_count')::bigint<j.row_count
    or p_model->>'row_count' is null or p_summary->>'row_count' is null
    or p_model->>'row_count' is distinct from p_summary->>'row_count'
    or jsonb_typeof(p_model->'products') is distinct from 'array'
    or jsonb_typeof(p_model->'totals') is distinct from 'object'
    or (p_cursor=j.cursor_id and (p_model->>'row_count')::bigint<>j.row_count)
    then raise exception 'Invalid finance page'; end if;
  -- Reject inconsistent totals before publishing a new durable snapshot.
  if exists(select 1 from jsonb_each_text(p_summary->'totals') s
      where public.wb_api_finance_cents(s.value)<>public.wb_api_finance_cents(p_model->'totals'->>s.key))
    then raise exception 'Finance totals mismatch'; end if;
  update public.wb_api_preview_jobs set cursor_id=p_cursor,summary=p_summary,
    finance_model=p_model,finance_storage='aggregate',row_count=(p_model->>'row_count')::bigint,
    status=p_status,failure_count=0,error_message=null,updated_at=now() where id=j.id;
  return true;
end; $$;
revoke all on function public.wb_api_commit_finance_page(uuid,uuid,bigint,bigint,bigint,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.wb_api_commit_finance_page(uuid,uuid,bigint,bigint,bigint,jsonb,jsonb,text) to service_role;

-- New ingestion must never reopen raw staging. Existing legacy rows are NOT
-- removed by this migration: archive and verify before the separate cleanup.
create function public.wb_api_reject_compact_raw_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.wb_api_preview_jobs where id=new.job_id and finance_storage='aggregate')
    then raise exception 'Raw operation storage is disabled for compact snapshots'; end if;
  return new;
end; $$;
create trigger wb_api_compact_no_raw before insert or update on public.wb_api_preview_rows
for each row execute function public.wb_api_reject_compact_raw_write();
revoke all on function public.wb_api_reject_compact_raw_write() from public,anon,authenticated;

-- Preserve exact policy logic, including shared storefront permissions.
-- Hoist the user identity out of the per-row checks; never widen access.
do $$
declare p record; q text; c text;
begin
  for p in select * from pg_policies where schemaname='public'
    and (qual like '%auth.uid()%' or with_check like '%auth.uid()%') loop
    q=replace(p.qual,'auth.uid()','(select auth.uid())');
    c=replace(p.with_check,'auth.uid()','(select auth.uid())');
    execute format('alter policy %I on %I.%I%s%s',p.policyname,p.schemaname,p.tablename,
      case when q is not null then ' using ('||q||')' else '' end,
      case when c is not null then ' with check ('||c||')' else '' end);
  end loop;
end; $$;
