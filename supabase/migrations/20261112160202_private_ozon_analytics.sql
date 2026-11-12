-- Private compact Ozon accruals. Original XLSX and operation IDs are not stored.
create table public.ozon_analytics_months (
 shop_id uuid not null references public.shops(id) on delete cascade,
 month date not null check(extract(day from month)=1),
 upload_id uuid not null references public.uploads(id) on delete cascade,
 model jsonb not null check(jsonb_typeof(model)='object' and model->>'version'='1'),
 updated_at timestamptz not null default now(), primary key(shop_id,month)
);
create index ozon_analytics_upload_idx on public.ozon_analytics_months(upload_id);
alter table public.ozon_analytics_months enable row level security;
revoke all on public.ozon_analytics_months from public,anon,authenticated;
grant all on public.ozon_analytics_months to service_role;

create function public.import_ozon_report(p_shop_id uuid,p_filename text,p_periods jsonb,p_row_count integer)
returns integer language plpgsql security definer set search_path='' as $$
declare p jsonb; m date; journal uuid; seen date[]:='{}'; cards jsonb; count_rows integer;
begin
 if auth.uid() is distinct from 'bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid then raise exception 'Forbidden'; end if;
 if not exists(select 1 from public.shops s where s.id=p_shop_id and (s.owner_id=auth.uid() or exists(select 1 from public.shop_members t where t.shop_id=s.id and t.user_id=auth.uid()))) then raise exception 'Forbidden'; end if;
 if jsonb_typeof(p_periods) is distinct from 'array' or jsonb_array_length(p_periods) not between 1 and 36
   or octet_length(p_periods::text)>16000000 or p_row_count not between 1 and 5000000 or p_filename is null then raise exception 'Invalid report'; end if;
 perform pg_advisory_xact_lock(hashtextextended('ozon-import:'||p_shop_id::text,0));
 insert into public.uploads(shop_id,marketplace,kind,filename,periods,row_count)
  values(p_shop_id,'ozon','ozon_accruals',left(p_filename,300),(select jsonb_agg((x->'report') - array['sales_amount','orders_amount','bought_qty','transfer_goods','transfer_total','delivery_cost','storage_cost','fines','acceptance_ops','damage_comp','return_comp','other_fees','ads_spend','ads_promo_spend']) from jsonb_array_elements(p_periods) x),p_row_count) returning id into journal;
 count_rows:=0;
 for p in select * from jsonb_array_elements(p_periods) loop
  m:=make_date((p->'report'->>'year')::integer,(p->'report'->>'month')::integer,1);
  if m=any(seen) or p->'analytics'->>'version' is distinct from '1' or jsonb_typeof(p->'skus') is distinct from 'array'
   or (p->'analytics'->'coverage'->>'from')::date<m or (p->'analytics'->'coverage'->>'to')::date>m+interval '1 month'-interval '1 day'
   or (p->'analytics'->'coverage'->>'from')::date>(p->'analytics'->'coverage'->>'to')::date then raise exception 'Invalid monthly coverage'; end if;
  seen:=array_append(seen,m);
  count_rows:=count_rows+(p->'analytics'->'totals'->>'rows')::integer;
  if abs((p->'analytics'->'totals'->>'sales')::numeric-round((p->'report'->>'sales_amount')::numeric,2))>0.011
   or abs((p->'analytics'->'totals'->>'net')::numeric-(round((p->'report'->>'transfer_total')::numeric,2)-round((p->'report'->>'ads_spend')::numeric,2)))>0.011
   or (p->'analytics'->'totals'->>'quantity')::integer<>(p->'report'->>'bought_qty')::integer then raise exception 'Monthly totals differ'; end if;
  insert into public.monthly_reports(shop_id,marketplace,year,month,sales_amount, orders_amount, bought_qty, transfer_goods, transfer_total, delivery_cost, storage_cost, fines, acceptance_ops, damage_comp, return_comp, other_fees, ads_spend, ads_promo_spend,updated_at)
   values(p_shop_id,'ozon',extract(year from m),extract(month from m),round((p->'report'->>'sales_amount')::numeric,2), round((p->'report'->>'orders_amount')::numeric,2), round((p->'report'->>'bought_qty')::numeric,2), round((p->'report'->>'transfer_goods')::numeric,2), round((p->'report'->>'transfer_total')::numeric,2), round((p->'report'->>'delivery_cost')::numeric,2), round((p->'report'->>'storage_cost')::numeric,2), round((p->'report'->>'fines')::numeric,2), round((p->'report'->>'acceptance_ops')::numeric,2), round((p->'report'->>'damage_comp')::numeric,2), round((p->'report'->>'return_comp')::numeric,2), round((p->'report'->>'other_fees')::numeric,2), round((p->'report'->>'ads_spend')::numeric,2), round((p->'report'->>'ads_promo_spend')::numeric,2),now())
   on conflict(shop_id,marketplace,year,month) do update set sales_amount=excluded.sales_amount, orders_amount=excluded.orders_amount, bought_qty=excluded.bought_qty, transfer_goods=excluded.transfer_goods, transfer_total=excluded.transfer_total, delivery_cost=excluded.delivery_cost, storage_cost=excluded.storage_cost, fines=excluded.fines, acceptance_ops=excluded.acceptance_ops, damage_comp=excluded.damage_comp, return_comp=excluded.return_comp, other_fees=excluded.other_fees, ads_spend=excluded.ads_spend, ads_promo_spend=excluded.ads_promo_spend,updated_at=now();
  delete from public.sku_sales where shop_id=p_shop_id and marketplace='ozon' and year=extract(year from m) and month=extract(month from m);
  insert into public.sku_sales(shop_id,marketplace,year,month,article,name,bought_qty,revenue)
   select p_shop_id,'ozon',extract(year from m),extract(month from m),r.article,r.name,r.bought_qty,r.revenue
    from jsonb_to_recordset(p->'skus') r(article text,name text,bought_qty integer,revenue numeric);
  select jsonb_agg(jsonb_build_object('article',x->>'article','name',x->>'name')) into cards from jsonb_array_elements(p->'skus') x;
  if cards is not null then perform public.seed_cost_cards(p_shop_id,cards); end if;
  insert into public.ozon_analytics_months(shop_id,month,upload_id,model) values(p_shop_id,m,journal,p->'analytics')
   on conflict(shop_id,month) do update set upload_id=excluded.upload_id,model=excluded.model,updated_at=now();
 end loop;
 if count_rows<>p_row_count then raise exception 'Row coverage differs'; end if;
 return cardinality(seen);
end; $$;
revoke all on function public.import_ozon_report(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.import_ozon_report(uuid,text,jsonb,integer) to authenticated;
