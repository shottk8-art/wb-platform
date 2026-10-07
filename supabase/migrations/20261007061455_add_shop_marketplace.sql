alter table public.shops
  add column if not exists marketplace text not null default 'wildberries';

alter table public.shops
  drop constraint if exists shops_marketplace_check;

alter table public.shops
  add constraint shops_marketplace_check
  check (marketplace in ('wildberries', 'ozon'));

create index if not exists shops_marketplace_idx
  on public.shops(owner_id, marketplace);

create or replace function public.admin_overview()
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'telegram_username', u.raw_user_meta_data->>'telegram_username',
        'full_name', u.raw_user_meta_data->>'full_name',
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at
      ) order by u.created_at desc), '[]'::jsonb)
      from auth.users u
    ),
    'shops', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'slug', s.slug,
        'marketplace', s.marketplace,
        'owner_id', s.owner_id,
        'share_enabled', s.share_enabled,
        'created_at', s.created_at,
        'member_count', (select count(*) from shop_members m where m.shop_id = s.id),
        'upload_count', (select count(*) from uploads up where up.shop_id = s.id),
        'last_upload_at', (select max(up.created_at) from uploads up where up.shop_id = s.id)
      ) order by s.created_at desc), '[]'::jsonb)
      from shops s
    )
  ) into result;

  return result;
end;
$$;

revoke execute on function public.admin_overview() from public;
grant execute on function public.admin_overview() to authenticated;
