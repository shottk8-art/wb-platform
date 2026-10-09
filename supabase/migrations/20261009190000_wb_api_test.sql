-- WB API pilot: no client role can read keys, connections or staging rows.
-- Financial staging deliberately does not touch monthly_reports/sku_sales/uploads.
create extension if not exists supabase_vault with schema vault;

create table public.wb_api_connections (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  secret_id uuid not null unique,
  seller_id text not null unique,
  seller_name text not null,
  expires_at timestamptz,
  checked_at timestamptz not null default now(),
  next_request_at timestamptz not null default now(),
  next_check_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table public.wb_api_preview_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.wb_api_connections(shop_id) on delete cascade,
  date_from date not null,
  date_to date not null,
  cursor_id bigint not null default 0,
  status text not null default 'loading' check (status in ('loading', 'complete', 'error')),
  summary jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (date_from <= date_to)
);
create index wb_api_preview_jobs_shop_idx on public.wb_api_preview_jobs(shop_id, created_at desc);
create table public.wb_api_preview_rows (
  job_id uuid not null references public.wb_api_preview_jobs(id) on delete cascade,
  rrd_id bigint not null,
  payload jsonb not null,
  primary key (job_id, rrd_id)
);
alter table public.wb_api_connections enable row level security;
alter table public.wb_api_preview_jobs enable row level security;
alter table public.wb_api_preview_rows enable row level security;
revoke all on public.wb_api_connections, public.wb_api_preview_jobs, public.wb_api_preview_rows from public, anon, authenticated;
grant all on public.wb_api_connections, public.wb_api_preview_jobs, public.wb_api_preview_rows to service_role;

create function public.wb_api_save_key(p_shop_id uuid, p_key text, p_seller_id text, p_seller_name text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret_id uuid; v_seller_id text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text, 0));
  select secret_id, seller_id into v_secret_id, v_seller_id from public.wb_api_connections where shop_id = p_shop_id for update;
  if v_seller_id is not null and v_seller_id <> p_seller_id then raise exception 'Seller mismatch'; end if;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_key, 'wb-api-' || p_shop_id::text, 'WB read-only integration');
  else
    perform vault.update_secret(v_secret_id, p_key);
  end if;
  insert into public.wb_api_connections(shop_id, secret_id, seller_id, seller_name, expires_at, next_check_at)
  values(p_shop_id, v_secret_id, p_seller_id, p_seller_name, p_expires_at, now() + interval '15 seconds')
  on conflict(shop_id) do update set seller_name = excluded.seller_name, expires_at = excluded.expires_at, checked_at = now(), next_check_at = excluded.next_check_at;
end; $$;
create function public.wb_api_read_key(p_shop_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  select s.decrypted_secret into v_key from vault.decrypted_secrets s
  join public.wb_api_connections c on c.secret_id = s.id where c.shop_id = p_shop_id;
  return v_key;
end; $$;
create function public.wb_api_claim_request(p_shop_id uuid, p_kind text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_next timestamptz; v_wait integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if p_kind not in ('finance', 'check') then raise exception 'Invalid kind'; end if;
  select case when p_kind = 'finance' then next_request_at else next_check_at end
  into v_next from public.wb_api_connections where shop_id = p_shop_id for update;
  if not found then raise exception 'Not connected'; end if;
  v_wait := greatest(0, ceil(extract(epoch from v_next - now()))::integer);
  if v_wait > 0 then return v_wait; end if;
  update public.wb_api_connections set
    next_request_at = case when p_kind = 'finance' then now() + interval '63 seconds' else next_request_at end,
    next_check_at = case when p_kind = 'check' then now() + interval '15 seconds' else next_check_at end
  where shop_id = p_shop_id;
  return 0;
end; $$;
create function public.wb_api_cleanup_key()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end; $$;
create trigger wb_api_delete_secret after delete on public.wb_api_connections
for each row execute function public.wb_api_cleanup_key();

revoke all on function public.wb_api_save_key(uuid,text,text,text,timestamptz), public.wb_api_read_key(uuid), public.wb_api_claim_request(uuid,text), public.wb_api_cleanup_key() from public, anon, authenticated;
grant execute on function public.wb_api_save_key(uuid,text,text,text,timestamptz), public.wb_api_read_key(uuid), public.wb_api_claim_request(uuid,text) to service_role;
