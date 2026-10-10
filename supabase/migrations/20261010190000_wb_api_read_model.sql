-- Immutable finance aggregates per committed snapshot. Costs/tax/manual spend
-- remain live and are deliberately NOT cached here. Raw audit rows are kept.
alter table public.wb_api_preview_jobs add column finance_model jsonb;

create function public.wb_api_finance_cents(value text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if value is null or value = '' then return 0; end if;
  if value !~ '^-?[0-9]+(\.[0-9]{1,2})?$' then
    raise exception 'Invalid financial amount';
  end if;
  return value::numeric * 100;
end; $$;

create function public.wb_api_finance_read_model(p_job_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  j public.wb_api_preview_jobs%rowtype;
  result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  select * into j from public.wb_api_preview_jobs where id=p_job_id;
  if not found then raise exception 'Snapshot not found'; end if;
  if j.finance_model->>'version'='1'
    and (j.finance_model->>'row_count')::bigint=j.row_count
    and j.finance_model->>'cursor_id'=j.cursor_id::text then return j.finance_model; end if;
  -- Only a cold snapshot takes a lock. Concurrent readers build it once;
  -- committed cursor bounds exclude rows from an interrupted worker attempt.
  select * into j from public.wb_api_preview_jobs where id=p_job_id for update;
  if j.finance_model->>'version'='1'
    and (j.finance_model->>'row_count')::bigint=j.row_count
    and j.finance_model->>'cursor_id'=j.cursor_id::text then return j.finance_model; end if;
  with rows as materialized (
    select rrd_id,payload,
      case when lower(coalesce(payload->>'docTypeName',''))='возврат' then -1 else 1 end as financial_sign,
      case when payload->>'docTypeName'='Возврат' then -1 else 1 end as product_sign,
      coalesce(nullif(payload->>'vendorCode',''),nullif(payload->>'nmId',''),'') as article
    from public.wb_api_preview_rows where job_id=j.id and rrd_id<=j.cursor_id
  ), amounts as (
    select f.key,coalesce(sum(public.wb_api_finance_cents(r.payload->>f.key)
      * case when f.signed then r.financial_sign else 1 end),0) as amount
    from (values ('retailAmount',true),('forPay',true),('deliveryService',false),
      ('paidStorage',false),('paidAcceptance',false),('penalty',false),('deduction',false),
      ('cashbackAmount',true),('cashbackDiscount',true),('cashbackCommissionChange',true),
      ('additionalPayment',false)) f(key,signed) left join rows r on true group by f.key
    union all
    select 'advertisingDeductions',coalesce(sum(public.wb_api_finance_cents(payload->>'deduction')) filter (
      where lower(coalesce(nullif(payload->>'bonusTypeName',''),payload->>'sellerOperName',''))
        ~ '(вб|wb)[.\s]*(продвижение|медиа|media)|услуги (по )?реклам'),0) from rows
  ), products as (
    select article,
      coalesce((array_agg(left(payload->>'title',300) order by rrd_id)
        filter (where coalesce(payload->>'title','')<>''))[1],'') as name,
      coalesce(sum(product_sign*coalesce(nullif(payload->>'quantity',''),'0')::numeric)
        filter (where payload->>'sellerOperName' in ('Продажа','Возврат')),0) as bought_qty,
      sum(product_sign*public.wb_api_finance_cents(payload->>'forPay')) as for_pay,
      sum(product_sign*public.wb_api_finance_cents(payload->>'retailAmount')) as revenue
    from rows where article<>'' group by article
  )
  select jsonb_build_object('version',1,'cursor_id',j.cursor_id::text,'row_count',(select count(*) from rows),
    'totals',(select jsonb_object_agg(key,(amount/100)::numeric(30,2)::text) from amounts),
    'bought_qty',coalesce((select sum(bought_qty) from products),0),
    'products',coalesce((select jsonb_agg(jsonb_build_object('article',article,'name',name,
      'bought_qty',bought_qty,'for_pay',(for_pay/100)::numeric(30,2)::text,
      'revenue',(revenue/100)::numeric(30,2)::text) order by article) from products),'[]'::jsonb)) into result;
  if (result->>'row_count')::bigint<>j.row_count then raise exception 'Snapshot row count mismatch'; end if;
  update public.wb_api_preview_jobs set finance_model=result where id=j.id;
  return result;
end; $$;

revoke all on function public.wb_api_finance_cents(text),public.wb_api_finance_read_model(uuid) from public,anon,authenticated;
grant execute on function public.wb_api_finance_cents(text),public.wb_api_finance_read_model(uuid) to service_role;
