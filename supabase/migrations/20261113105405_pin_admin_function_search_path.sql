-- Preserve admin identity, caller rights and all RLS behavior; only pin lookup.
alter function public.is_admin(uuid) set search_path = '';
