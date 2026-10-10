-- Match JavaScript truthiness: numeric nmId=0 is a service row, not a SKU.
create or replace function public.wb_api_finance_read_model(p_job_id uuid)
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
      coalesce(
        case when payload->'vendorCode' not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then payload->>'vendorCode' end,
        case when payload->'nmId' not in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb) then payload->>'nmId' end,'') as article
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

-- Repair only derived cache entries, never raw WB data. A legitimate string
-- article "0" is preserved/rebuilt; nonzero ambiguous aggregates are rebuilt.
do $$
declare j record; zero_product jsonb;
begin
  for j in select id,finance_model from public.wb_api_preview_jobs
    where finance_model is not null and exists (
      select 1 from jsonb_array_elements(finance_model->'products') p where p->>'article'='0'
    )
  loop
    select p into zero_product from jsonb_array_elements(j.finance_model->'products') p where p->>'article'='0';
    if coalesce(zero_product->>'name','')='' and (zero_product->>'bought_qty')::numeric=0
      and (zero_product->>'for_pay')::numeric=0 and (zero_product->>'revenue')::numeric=0
      and not exists (select 1 from public.wb_api_preview_rows where job_id=j.id
        and (payload->'vendorCode'='"0"'::jsonb or payload->'nmId'='"0"'::jsonb)) then
      update public.wb_api_preview_jobs set finance_model=jsonb_set(finance_model,'{products}',
        (select coalesce(jsonb_agg(p),'[]'::jsonb) from jsonb_array_elements(finance_model->'products') p where p->>'article'<>'0'))
        where id=j.id;
    else
      update public.wb_api_preview_jobs set finance_model=null where id=j.id;
    end if;
  end loop;
end; $$;

