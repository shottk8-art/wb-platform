-- Cover the audit foreign key as the number of managed accounts grows.
create index user_section_access_updated_by_idx on public.user_section_access(updated_by);
