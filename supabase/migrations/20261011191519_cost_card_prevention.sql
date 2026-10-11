set transaction read write;
-- Serialize creation/editing of the same logical article, not the whole store.
create or replace function public.seed_cost_cards(p_shop_id uuid,p_cards jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare item jsonb; article_value text; added integer:=0;
begin
  if p_shop_id is null or jsonb_typeof(p_cards) is distinct from 'array'
    or jsonb_array_length(p_cards)>50000 then
    raise exception 'Некорректный список товаров';
  end if;
  for item in select distinct on (lower(btrim(value->>'article'))) value from jsonb_array_elements(p_cards) with ordinality
    order by lower(btrim(value->>'article')),ordinality loop
    article_value:=btrim(item->>'article');
    if jsonb_typeof(item) is distinct from 'object' or article_value is null
      or article_value='' or length(article_value)>500 then
      raise exception 'Проверьте артикул товара';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('wb.cost.card:'||p_shop_id::text||':'||lower(article_value),0));
    if not exists(select 1 from public.sku_costs where shop_id=p_shop_id
      and lower(btrim(article))=lower(article_value)) then
      insert into public.sku_costs(shop_id,article,name,cost_price)
        values(p_shop_id,article_value,coalesce(item->>'name',''),0)
        on conflict(shop_id,article) do nothing;
      if found then added:=added+1; end if;
    end if;
  end loop;
  return added;
end; $$;
revoke all on function public.seed_cost_cards(uuid,jsonb) from public,anon;
grant execute on function public.seed_cost_cards(uuid,jsonb) to authenticated,service_role;

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
    perform pg_advisory_xact_lock(hashtextextended('wb.cost.card:'||p_shop_id::text||':'||lower(article_value),0));
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
