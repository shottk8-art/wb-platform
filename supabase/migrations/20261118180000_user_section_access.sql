-- Account-wide section permissions. Existing shop ownership/membership remains
-- mandatory and is never created by a section grant.
create table public.user_section_access (
 user_id uuid not null references auth.users(id) on delete cascade,
 section text not null check(section in ('overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes')),
 allowed boolean not null,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 primary key(user_id,section)
);
alter table public.user_section_access enable row level security;
revoke all on public.user_section_access from public,anon,authenticated;
grant select on public.user_section_access to authenticated;
grant all on public.user_section_access to service_role;
create policy "read own section permissions" on public.user_section_access for select to authenticated
 using(user_id=(select auth.uid()) or (select public.is_admin()));

create or replace function public.app_section_allowed(p_section text,p_user_id uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path='' as $$
declare choice boolean;
begin
 if p_user_id is null then return false; end if;
 if auth.role()='authenticated' and p_user_id is distinct from auth.uid() and not public.is_admin() then
  raise exception 'Forbidden' using errcode='42501';
 end if;
 if p_section not in ('overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes') then return false; end if;
 if public.is_admin(p_user_id) then return true; end if;
 select a.allowed into choice from public.user_section_access a where a.user_id=p_user_id and a.section=p_section;
 if found then return choice; end if;
 if p_section='promocodes' then
  return exists(select 1 from public.wb_promo_viewers v where v.user_id=p_user_id);
 end if;
 return p_section in ('overview','reports','costs','team','settings','account');
end; $$;
revoke all on function public.app_section_allowed(text,uuid) from public,anon;
grant execute on function public.app_section_allowed(text,uuid) to authenticated,service_role;

create or replace function public.my_section_access()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',auth.uid(),'is_admin',coalesce(public.is_admin(),false),'sections',
  (select jsonb_object_agg(key,public.app_section_allowed(key)) from unnest(array['overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes']) key))
 where auth.uid() is not null;
$$;
revoke all on function public.my_section_access() from public,anon;
grant execute on function public.my_section_access() to authenticated;

create or replace function public.admin_user_section_access(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Пользователь не найден'; end if;
 return jsonb_build_object('user_id',p_user_id,'is_admin',public.is_admin(p_user_id),'sections',
  (select jsonb_object_agg(key,public.app_section_allowed(key,p_user_id)) from unnest(array['overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes']) key));
end; $$;
revoke all on function public.admin_user_section_access(uuid) from public,anon;
grant execute on function public.admin_user_section_access(uuid) to authenticated;

create or replace function public.admin_save_section_access(p_user_id uuid,p_sections jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(public.is_admin(),false) then raise exception 'Forbidden' using errcode='42501'; end if;
 if public.is_admin(p_user_id) then raise exception 'У администратора всегда полный доступ'; end if;
 if (p_sections->>'ai')='true' and (p_sections->>'overview') is distinct from 'true' then raise exception 'Для ИИ-анализа также откройте Обзор'; end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Пользователь не найден'; end if;
 if jsonb_typeof(p_sections) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_sections))<>10
  or exists(select 1 from jsonb_each(p_sections) x where x.key not in ('overview','daily','stocks','reports','costs','team','settings','account','ai','promocodes') or jsonb_typeof(x.value)<>'boolean') then
  raise exception 'Проверьте список разделов';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('section-access:'||p_user_id::text,0));
 insert into public.user_section_access(user_id,section,allowed,updated_by)
  select p_user_id,x.key,x.value::boolean,auth.uid() from jsonb_each(p_sections) x
 on conflict(user_id,section) do update set allowed=excluded.allowed,updated_by=excluded.updated_by,updated_at=now();
 return public.admin_user_section_access(p_user_id);
end; $$;
revoke all on function public.admin_save_section_access(uuid,jsonb) from public,anon;
grant execute on function public.admin_save_section_access(uuid,jsonb) to authenticated;

-- Background collection follows explicit feature access on an existing shop.
create or replace function public.app_shop_section_enabled(p_shop_id uuid,p_section text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.shops s where s.id=p_shop_id and
  (public.app_section_allowed(p_section,s.owner_id) or exists(select 1 from public.shop_members m
   where m.shop_id=s.id and m.user_id is not null and public.app_section_allowed(p_section,m.user_id))));
$$;
revoke all on function public.app_shop_section_enabled(uuid,text) from public,anon,authenticated;
grant execute on function public.app_shop_section_enabled(uuid,text) to service_role;

-- Restrictive policies add section boundaries to the existing permissive shop
-- policies. They cannot grant access to another shop or to private API tables.
create policy section_read on public.monthly_reports as restrictive for select to authenticated using
 ((select public.app_section_allowed('overview') or public.app_section_allowed('daily') or public.app_section_allowed('reports') or public.app_section_allowed('ai')));
create policy section_read on public.sku_sales as restrictive for select to authenticated using
 ((select public.app_section_allowed('overview') or public.app_section_allowed('daily') or public.app_section_allowed('reports') or public.app_section_allowed('ai')));
create policy section_read on public.sku_costs as restrictive for select to authenticated using
 ((select public.app_section_allowed('costs') or public.app_section_allowed('overview') or public.app_section_allowed('daily') or public.app_section_allowed('reports') or public.app_section_allowed('ai')));
create policy section_read on public.uploads as restrictive for select to authenticated using
 ((select public.app_section_allowed('reports') or public.app_section_allowed('overview') or public.app_section_allowed('daily') or public.app_section_allowed('ai')));
create policy section_team_read on public.shop_members as restrictive for select to authenticated using
 (user_id=(select auth.uid()) or (select public.app_section_allowed('team')));

-- File imports may seed zero-price cards or update names without opening the
-- cost editor. They never acquire a second route for changing purchase prices.
create function public.enforce_cost_section() returns trigger
language plpgsql set search_path='' as $$
begin
 if auth.role()='authenticated' and not public.app_section_allowed('costs') then
  if (tg_op='INSERT' and coalesce(new.cost_price,0)<>0) or (tg_op='UPDATE' and new.cost_price is distinct from old.cost_price) then
   raise exception 'Раздел себестоимости недоступен' using errcode='42501';
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.enforce_cost_section() from public,anon,authenticated;
create trigger section_cost_price before insert or update on public.sku_costs for each row execute function public.enforce_cost_section();

do $$ declare t text; rule text; begin
 foreach t in array array['monthly_reports','sku_sales','sku_costs','uploads','shop_members','shops'] loop
  rule:=case t when 'monthly_reports' then '(select public.app_section_allowed(''reports'') or public.app_section_allowed(''overview''))'
   when 'sku_sales' then '(select public.app_section_allowed(''reports''))'
   when 'sku_costs' then '(select public.app_section_allowed(''costs'') or public.app_section_allowed(''reports''))'
   when 'uploads' then '(select public.app_section_allowed(''reports'') or public.app_section_allowed(''costs''))'
   when 'shop_members' then '(select public.app_section_allowed(''team''))'
   else '(select public.app_section_allowed(''settings''))' end;
  execute format('create policy section_insert on public.%I as restrictive for insert to authenticated with check (%s)',t,rule);
  execute format('create policy section_update on public.%I as restrictive for update to authenticated using (%s) with check (%s)',t,rule,rule);
  execute format('create policy section_delete on public.%I as restrictive for delete to authenticated using (%s)',t,rule);
 end loop;
end $$;

-- Security-definer import bypasses RLS, so check its section explicitly. Other
-- import shop checks and the existing atomic validation remain unchanged.
do $$ declare src text; old text:='if auth.uid() is distinct from ''bbb002c4-cd7a-490d-b9c0-72aed5424261''::uuid then'; begin
 select pg_get_functiondef('public.import_ozon_report(uuid,text,jsonb,integer)'::regprocedure) into src;
 if strpos(src,old)=0 then raise exception 'Unexpected Ozon import gate'; end if;
 execute replace(src,old,'if not public.app_section_allowed(''reports'') then');
end $$;

do $$ declare src text; begin
 select pg_get_functiondef('public.get_complete_periods(uuid,text)'::regprocedure) into src;
 if strpos(src,'s.id = p_shop_id')=0 then raise exception 'Unexpected period function'; end if;
 execute replace(src,'s.id = p_shop_id','s.id = p_shop_id and (auth.uid() is null or public.app_section_allowed(''overview'') or public.app_section_allowed(''daily'') or public.app_section_allowed(''reports'') or public.app_section_allowed(''ai''))');
 select pg_get_functiondef('public.save_cost_prices(uuid,jsonb)'::regprocedure) into src;
 execute replace(src,'begin','begin'||E'\n  if auth.uid() is not null and not public.app_section_allowed(''costs'') then raise exception ''Раздел себестоимости недоступен'' using errcode=''42501''; end if;');
end $$;

do $$ declare n text; src text; old text:='s.owner_id=''bbb002c4-cd7a-490d-b9c0-72aed5424261''::uuid'; begin
 foreach n in array array['wb_stock_enqueue(uuid)','wb_stock_accept_lease(uuid,uuid)','wb_stock_dispatch()','wb_api_queue_recent_unit(uuid)'] loop
  select pg_get_functiondef(('public.'||n)::regprocedure) into src;
  if strpos(src,old)=0 then raise exception 'Unexpected feature collection gate: %',n; end if;
  execute replace(src,old,case when n='wb_api_queue_recent_unit(uuid)' then 'public.app_shop_section_enabled(s.id,''daily'')' else 'public.app_shop_section_enabled(s.id,''stocks'')' end);
 end loop;
 select pg_get_functiondef('public.wb_stock_set_tracking(uuid,text,boolean)'::regprocedure) into src;
 old:='owner_id=''bbb002c4-cd7a-490d-b9c0-72aed5424261''::uuid';
 if strpos(src,old)=0 then raise exception 'Unexpected inventory tracking gate'; end if;
 execute replace(src,old,'public.app_shop_section_enabled(id,''stocks'')');
end $$;
