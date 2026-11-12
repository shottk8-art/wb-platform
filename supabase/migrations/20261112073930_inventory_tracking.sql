-- Durable monitoring preferences, independent of an API connection/snapshot.
create table public.wb_stock_tracking (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  excluded_products jsonb not null default '{}' check(jsonb_typeof(excluded_products)='object'),
  updated_at timestamptz not null default now(),
  check(shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid)
);
alter table public.wb_stock_tracking enable row level security;
revoke all on public.wb_stock_tracking from public,anon,authenticated;
grant all on public.wb_stock_tracking to service_role;

create function public.wb_stock_set_tracking(p_shop_id uuid,p_nm_id text,p_excluded boolean)
returns void language plpgsql security definer set search_path='' as $$
declare old jsonb; item jsonb;
begin
  if auth.role() is distinct from 'service_role' or p_shop_id is distinct from '853b81a0-e0e2-4195-bc80-1cdc362af946'::uuid then raise exception 'Forbidden'; end if;
  if p_nm_id is null or p_nm_id!~'^[1-9][0-9]{0,19}$' or p_excluded is null then raise exception 'Invalid product'; end if;
  if not exists(select 1 from public.shops where id=p_shop_id and owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'::uuid) then raise exception 'Forbidden'; end if;
  insert into public.wb_stock_tracking(shop_id) values(p_shop_id) on conflict do nothing;
  select excluded_products into old from public.wb_stock_tracking where shop_id=p_shop_id for update;
  if p_excluded then
    if old ? p_nm_id then return; end if;
    if (select count(*) from jsonb_object_keys(old))>=10000 then raise exception 'Tracking limit'; end if;
    select p into item from public.wb_stock_snapshots s cross join lateral jsonb_array_elements(s.snapshot->'catalogue') p
      where s.shop_id=p_shop_id and p->>'nm_id'=p_nm_id limit 1;
    -- Preserve a small identity even if WB later removes a retired card. No
    -- source quantities or order history are copied into these preferences.
    item:=jsonb_build_object('nm_id',p_nm_id,'article',coalesce(item->>'article',p_nm_id),
      'name',coalesce(item->>'name','Артикул WB '||p_nm_id),'excluded_at',now());
    update public.wb_stock_tracking set excluded_products=jsonb_set(excluded_products,array[p_nm_id],item),updated_at=now() where shop_id=p_shop_id;
  else
    update public.wb_stock_tracking set excluded_products=excluded_products-p_nm_id,updated_at=now() where shop_id=p_shop_id;
  end if;
end; $$;
revoke all on function public.wb_stock_set_tracking(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.wb_stock_set_tracking(uuid,text,boolean) to service_role;
