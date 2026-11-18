-- Match the established server activation of an explicit pending invite.
-- Only owner-managed membership identity counts; never profile metadata.
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
  return exists(select 1 from public.wb_promo_viewers v where v.user_id=p_user_id
   or (v.user_id is null and exists(select 1 from public.shop_members m where m.shop_id=v.shop_id
    and m.user_id=p_user_id and m.telegram_username=v.telegram_username)));
 end if;
 return p_section in ('overview','reports','costs','team','settings','account');
end; $$;
