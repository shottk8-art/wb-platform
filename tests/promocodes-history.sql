-- Transactional integrity/access checks; no account data survives this test.
begin;
do $$
declare
  shop constant uuid:='853b81a0-e0e2-4195-bc80-1cdc362af946';
  campaign uuid:=gen_random_uuid(); other_campaign uuid:=gen_random_uuid();
  old_id uuid:=gen_random_uuid();
begin
  assert (select relrowsecurity from pg_class where oid='public.wb_promo_id_aliases'::regclass), 'RLS required';
  assert not has_table_privilege('anon','public.wb_promo_id_aliases','select,insert,update,delete'), 'No anonymous grants';
  assert not has_table_privilege('authenticated','public.wb_promo_id_aliases','select,insert,update,delete'), 'No client grants';
  insert into public.wb_promo_names(shop_id,promo_id,name) values(shop,campaign,'Rollback alias test');
  insert into public.wb_promo_id_aliases(shop_id,alias_id,promo_id) values(shop,old_id,campaign);
  begin
    insert into public.wb_promo_id_aliases(shop_id,alias_id,promo_id) values(shop,old_id,campaign);
    raise exception 'Duplicate alias accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.wb_promo_id_aliases(shop_id,alias_id,promo_id) values(shop,gen_random_uuid(),other_campaign);
    raise exception 'Orphan alias accepted';
  exception when foreign_key_violation then null; end;
  delete from public.wb_promo_names where shop_id=shop and promo_id=campaign;
  assert not exists(select 1 from public.wb_promo_id_aliases where shop_id=shop and alias_id=old_id), 'Deleted catalogue must revoke aliases';
end $$;
select 'Promo history SQL PASS: private RLS, uniqueness, catalogue FK and revocation cascade' as result;
rollback;
