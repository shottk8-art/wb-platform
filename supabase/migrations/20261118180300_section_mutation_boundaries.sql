-- Shared reads support calculations; writes remain owned by the section
-- responsible for the data. Report imports may seed catalogue names, but
-- cannot delete purchase prices or change manually entered period expenses.
drop policy section_delete on public.sku_costs;
create policy section_delete on public.sku_costs as restrictive for delete to authenticated
 using ((select public.app_section_allowed('costs')));

drop policy section_delete on public.monthly_reports;
create policy section_delete on public.monthly_reports as restrictive for delete to authenticated using
 ((select public.app_section_allowed('reports')) and
  ((select public.app_section_allowed('overview')) or (operational_expenses=0 and external_promotion_expenses=0)));

create function public.enforce_report_section() returns trigger language plpgsql set search_path='' as $$
declare reports boolean; overview boolean;
begin
 if auth.role() is distinct from 'authenticated' then return new; end if;
 reports:=public.app_section_allowed('reports');overview:=public.app_section_allowed('overview');
 if not overview then
  if (tg_op='INSERT' and (new.operational_expenses<>0 or new.external_promotion_expenses<>0))
   or (tg_op='UPDATE' and (new.operational_expenses is distinct from old.operational_expenses
    or new.external_promotion_expenses is distinct from old.external_promotion_expenses)) then
   raise exception 'Ручные расходы доступны в Обзоре' using errcode='42501';
  end if;
 end if;
 if not reports then
  if not overview then raise exception 'Раздел отчётов недоступен' using errcode='42501'; end if;
  if tg_op='INSERT' then
   -- Manual expense saving uses an upsert into an already imported period.
   -- It must not create a report. The UPDATE trigger then protects every
   -- non-manual column in the actual conflict update, including IDs/scope.
   if not exists(select 1 from public.monthly_reports r where r.shop_id=new.shop_id and r.marketplace=new.marketplace and r.year=new.year and r.month=new.month) then
    raise exception 'Загрузка отчётов недоступна' using errcode='42501';
   end if;
  elsif (to_jsonb(new)-array['operational_expenses','external_promotion_expenses','updated_at'])
    is distinct from (to_jsonb(old)-array['operational_expenses','external_promotion_expenses','updated_at']) then
   raise exception 'Изменение отчётов недоступно' using errcode='42501';
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.enforce_report_section() from public,anon,authenticated;
create trigger section_report_fields before insert or update on public.monthly_reports for each row execute function public.enforce_report_section();

drop policy section_insert on public.uploads;
drop policy section_update on public.uploads;
drop policy section_delete on public.uploads;
create policy section_insert on public.uploads as restrictive for insert to authenticated with check
 ((kind='costs' and (select public.app_section_allowed('costs'))) or (kind<>'costs' and (select public.app_section_allowed('reports'))));
create policy section_update on public.uploads as restrictive for update to authenticated using
 ((select public.app_section_allowed('reports')) and (kind<>'costs' or (select public.app_section_allowed('costs')))) with check
 ((select public.app_section_allowed('reports')) and (kind<>'costs' or (select public.app_section_allowed('costs'))));
create policy section_delete on public.uploads as restrictive for delete to authenticated using
 ((select public.app_section_allowed('reports')) and (kind<>'costs' or (select public.app_section_allowed('costs'))));
