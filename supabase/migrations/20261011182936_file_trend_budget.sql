set transaction read write;
-- Aggregate on the server instead of transferring every historical SKU row.
-- RLS is evaluated as the caller; public storefronts keep their current scope.
create function public.get_file_trend(p_shop_id uuid,p_marketplace text)
returns table(report jsonb,cogs numeric)
language sql stable security invoker set search_path='' as $$
  with periods as (
    select year,month from public.get_complete_periods(p_shop_id,p_marketplace)
    order by year desc,month desc limit 12
  ), reports as (
    select r.* from public.monthly_reports r join periods p using(year,month)
    where r.shop_id=p_shop_id and r.marketplace=p_marketplace
  )
  select to_jsonb(r),coalesce((select sum(s.bought_qty*coalesce(c.cost_price,0))
    from public.sku_sales s left join public.sku_costs c
      on c.shop_id=s.shop_id and c.article=s.article
    where s.shop_id=p_shop_id and s.marketplace=p_marketplace
      and s.year=r.year and s.month=r.month),0)
  from reports r order by r.year desc,r.month desc;
$$;
revoke all on function public.get_file_trend(uuid,text) from public;
grant execute on function public.get_file_trend(uuid,text) to anon,authenticated;
