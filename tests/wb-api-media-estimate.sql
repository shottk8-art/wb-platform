-- Only metadata is changed, inside rollback. No dispatch, HTTP or credentials.
begin;
set local statement_timeout='8s';
do $$
declare a uuid; b uuid; before_finance jsonb; before_orders jsonb; retried integer;
begin
  select j.id into a from public.wb_api_preview_jobs j join public.wb_api_connections c on c.shop_id=j.shop_id
    where j.status='complete' and j.date_from>=date_trunc('month',now() at time zone 'Europe/Moscow')::date-interval '11 months'
      and not exists(select 1 from public.wb_api_preview_jobs n where n.shop_id=j.shop_id and n.date_from=j.date_from and n.created_at>j.created_at and n.status in ('complete','loading'))
    order by j.updated_at desc limit 1 for update of j;
  select j.id into b from public.wb_api_preview_jobs j join public.wb_api_connections c on c.shop_id=j.shop_id
    where j.status='complete' and j.id<>a and j.date_from>=date_trunc('month',now() at time zone 'Europe/Moscow')::date-interval '11 months'
      and not exists(select 1 from public.wb_api_preview_jobs n where n.shop_id=j.shop_id and n.date_from=j.date_from and n.created_at>j.created_at and n.status in ('complete','loading'))
    order by j.updated_at desc limit 1 for update of j;
  assert a is not null and b is not null;
  select finance_model,summary#>'{api_sources,orders}' into before_finance,before_orders from public.wb_api_preview_jobs where id=a;
  update public.wb_api_preview_jobs set summary=jsonb_set(summary,'{api_sources,media}',jsonb_build_object('status','estimated','estimated',true,'amount','0.00','retry_stage','media_stats')),updated_at=now()-interval '7 hours' where id=a;
  update public.wb_api_preview_jobs set summary=jsonb_set(summary,'{api_sources,media}',jsonb_build_object('status','estimated','estimated',true,'amount','0.00','retry_stage','media_stats')),updated_at=now() where id=b;
  retried:=public.wb_api_retry_media_estimates();assert retried>=1;
  assert (select status='loading' and summary#>>'{pilot,stage}'='media_stats' and summary#>>'{api_sources,media,estimated}'='true' from public.wb_api_preview_jobs where id=a);
  assert (select finance_model=before_finance and summary#>'{api_sources,orders}'=before_orders from public.wb_api_preview_jobs where id=a),'Media retry must preserve all financial/order data';
  assert (select status='complete' from public.wb_api_preview_jobs where id=b),'fresh estimates respect six-hour backoff';
  assert not has_function_privilege('anon','public.wb_api_retry_media_estimates()','execute');
  assert not has_function_privilege('authenticated','public.wb_api_retry_media_estimates()','execute');
  assert public.is_admin('bbb002c4-cd7a-490d-b9c0-72aed5424261');
  assert not public.is_admin(gen_random_uuid());
end; $$;
rollback;
