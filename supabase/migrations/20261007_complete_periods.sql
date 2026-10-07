create or replace function public.get_complete_periods(p_shop_id uuid, p_marketplace text)
returns table(year int, month int)
language sql stable security definer
set search_path = public
as $$
  with permitted as (
    select 1
    from shops s
    where s.id = p_shop_id
      and (
        s.share_enabled
        or s.owner_id = auth.uid()
        or exists (select 1 from shop_members sm where sm.shop_id = s.id and sm.user_id = auth.uid())
      )
  ),
  summary_periods as (
    select distinct (p->>'year')::int as year, (p->>'month')::int as month
    from uploads u cross join lateral jsonb_array_elements(coalesce(u.periods, '[]'::jsonb)) p
    where u.shop_id = p_shop_id and u.marketplace = 'wildberries' and u.kind = 'summary'
  ),
  sales_periods as (
    select distinct u.year, u.month
    from uploads u
    where u.shop_id = p_shop_id and u.marketplace = 'wildberries' and u.kind = 'sales'
  ),
  ozon_periods as (
    select distinct (p->>'year')::int as year, (p->>'month')::int as month
    from uploads u cross join lateral jsonb_array_elements(coalesce(u.periods, '[]'::jsonb)) p
    where u.shop_id = p_shop_id and u.marketplace = 'ozon' and u.kind = 'ozon_accruals'
  )
  select result.year, result.month
  from permitted
  cross join lateral (
    select sp.year, sp.month
    from summary_periods sp
    join sales_periods sa using (year, month)
    where p_marketplace = 'wildberries'
    union
    select op.year, op.month from ozon_periods op where p_marketplace = 'ozon'
  ) result
  order by result.year desc, result.month desc;
$$;

revoke all on function public.get_complete_periods(uuid, text) from public;
grant execute on function public.get_complete_periods(uuid, text) to anon, authenticated;
