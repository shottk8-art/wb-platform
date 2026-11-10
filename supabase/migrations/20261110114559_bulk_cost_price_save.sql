-- Save an entire price file with two writes, not one UPDATE per input row.
-- Keep RLS, per-article concurrency locks, aliases and last-row-wins semantics.
create or replace function public.save_cost_prices(p_shop_id uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare normalized jsonb; updated integer; added integer;
begin
  if p_shop_id is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Некорректный список себестоимости';
  end if;
  if jsonb_array_length(p_rows)>10000 then
    raise exception 'Некорректный список себестоимости';
  end if;
  -- Validate every original row before collapsing duplicates or writing anything.
  if exists(select 1 from jsonb_array_elements(p_rows) as r(item)
    where jsonb_typeof(item) is distinct from 'object'
      or coalesce(btrim(item->>'article'),'')=''
      or length(btrim(item->>'article'))>500
      or coalesce(item->>'cost_price','') !~ '^[0-9]+([.][0-9]+)?$') then
    raise exception 'Проверьте артикул и себестоимость';
  end if;

  with input as materialized (
    select value, ordinality, lower(btrim(value->>'article')) as article_key
    from jsonb_array_elements(p_rows) with ordinality
  ), prices as (
    select distinct on (article_key) article_key,
      btrim(value->>'article') as article, (value->>'cost_price')::numeric as cost_price
    from input order by article_key, ordinality desc
  ), names as (
    select distinct on (article_key) article_key, value->>'name' as name
    from input where coalesce(value->>'name','')<>''
    order by article_key, ordinality desc
  )
  select coalesce(jsonb_agg(jsonb_build_object('article_key',p.article_key,
    'article',p.article,'cost_price',p.cost_price,'name',n.name)
    order by p.article_key),'[]'::jsonb)
  into normalized from prices p left join names n using(article_key);

  -- Use the same ordered locks as seed_cost_cards and individual edits.
  perform pg_advisory_xact_lock(hashtextextended(
    'wb.cost.card:'||p_shop_id::text||':'||(item->>'article_key'),0))
  from jsonb_array_elements(normalized) as r(item) order by item->>'article_key';

  with saved as (
    update public.sku_costs as c set cost_price=r.cost_price,
      name=coalesce(nullif(r.name,''),c.name),updated_at=now()
    from jsonb_to_recordset(normalized) as r(article_key text,name text,cost_price numeric)
    where c.shop_id=p_shop_id and lower(btrim(c.article))=r.article_key
    returning lower(btrim(c.article)) as article_key
  ) select count(distinct article_key) into updated from saved;

  with saved as (
    insert into public.sku_costs(shop_id,article,name,cost_price,updated_at)
    select p_shop_id,r.article,coalesce(r.name,''),r.cost_price,now()
    from jsonb_to_recordset(normalized) as r(article_key text,article text,name text,cost_price numeric)
    where not exists(select 1 from public.sku_costs c
      where c.shop_id=p_shop_id and lower(btrim(c.article))=r.article_key)
    on conflict(shop_id,article) do update set cost_price=excluded.cost_price,
      name=coalesce(nullif(excluded.name,''),sku_costs.name),updated_at=now()
    returning article
  ) select count(*) into added from saved;

  -- A shared shop can be visible without being editable. Never report a save
  -- if RLS filtered out any submitted logical article; roll back the whole call.
  if updated+added<>jsonb_array_length(normalized) then
    raise exception 'Нет доступа к редактированию себестоимости магазина' using errcode='42501';
  end if;

  return jsonb_array_length(normalized);
end;
$$;
revoke all on function public.save_cost_prices(uuid,jsonb) from public,anon;
grant execute on function public.save_cost_prices(uuid,jsonb) to authenticated;
