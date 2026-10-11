set transaction read write;
-- No historical rows are deleted or renamed. Match only within one shop.
create index if not exists sku_costs_shop_article_folded_idx
  on public.sku_costs(shop_id,lower(btrim(article)));

-- One atomic, RLS-scoped save for all casing aliases, including imports/undo.
create or replace function public.save_cost_prices(p_shop_id uuid,p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb; article_value text; name_value text; price_value numeric;
begin
  if p_shop_id is null or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows)>10000 then
    raise exception 'Некорректный список себестоимости';
  end if;
  for item in select value from jsonb_array_elements(p_rows) with ordinality
    order by lower(btrim(value->>'article')),ordinality loop
    article_value:=btrim(item->>'article');
    name_value:=item->>'name';
    if jsonb_typeof(item) is distinct from 'object' or article_value is null
      or article_value='' or length(article_value)>500
      or coalesce(item->>'cost_price','') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Проверьте артикул и себестоимость';
    end if;
    price_value:=(item->>'cost_price')::numeric;
    update public.sku_costs set cost_price=price_value,
      name=coalesce(nullif(name_value,''),name),updated_at=now()
      where shop_id=p_shop_id and lower(btrim(article))=lower(article_value);
    if not found then
      insert into public.sku_costs(shop_id,article,name,cost_price,updated_at)
        values(p_shop_id,article_value,coalesce(name_value,''),price_value,now())
        on conflict(shop_id,article) do update set
          cost_price=excluded.cost_price,
          name=coalesce(nullif(excluded.name,''),sku_costs.name),updated_at=now();
    end if;
  end loop;
  return (select count(distinct lower(btrim(value->>'article')))
    from jsonb_array_elements(p_rows));
end; $$;
revoke all on function public.save_cost_prices(uuid,jsonb) from public,anon;
grant execute on function public.save_cost_prices(uuid,jsonb) to authenticated;

create or replace function public.get_file_trend(p_shop_id uuid,p_marketplace text)
returns table(report jsonb,cogs numeric)
language sql stable security invoker set search_path='' as $$
  with periods as (
    select year,month from public.get_complete_periods(p_shop_id,p_marketplace)
    order by year desc,month desc limit 12
  ), reports as (
    select r.* from public.monthly_reports r join periods p using(year,month)
    where r.shop_id=p_shop_id and r.marketplace=p_marketplace
  ), prices as (
    select distinct on (lower(btrim(article))) lower(btrim(article)) as article_key,cost_price
    from public.sku_costs where shop_id=p_shop_id
    order by lower(btrim(article)),(cost_price>0) desc,updated_at desc,article collate "C"
  )
  select to_jsonb(r),coalesce((select sum(s.bought_qty*coalesce(c.cost_price,0))
    from public.sku_sales s left join prices c on c.article_key=lower(btrim(s.article))
    where s.shop_id=p_shop_id and s.marketplace=p_marketplace
      and s.year=r.year and s.month=r.month),0)
  from reports r order by r.year desc,r.month desc;
$$;
