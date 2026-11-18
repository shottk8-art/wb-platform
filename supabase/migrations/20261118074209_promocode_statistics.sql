-- TOPLASH-only compact promo facts and a separately authorized readonly audience.
-- No client table grants and no shop_members entries are created by invitations.
create table public.wb_promo_names (
  shop_id uuid not null references public.shops(id) on delete cascade check(shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'),
  promo_id uuid not null, name text not null check(length(btrim(name)) between 1 and 120),
  primary key(shop_id,promo_id)
);
create table public.wb_promo_viewers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade check(shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'),
  telegram_username text not null check(telegram_username ~ '^[a-z][a-z0-9_]{4,31}$'),
  user_id uuid references auth.users(id) on delete cascade,
  invited_at timestamptz not null default now(), unique(shop_id,telegram_username)
);
create index wb_promo_viewers_user_idx on public.wb_promo_viewers(user_id) where user_id is not null;
create table public.wb_promo_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.wb_api_connections(shop_id) on delete cascade check(shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'),
  date_from date not null,date_to date not null,finance_period text not null check(finance_period in ('daily','weekly')),
  status text not null default 'loading' check(status in ('loading','complete','error')),
  row_count integer not null default 0 check(row_count>=0),cursor_id bigint not null default 0 check(cursor_id>=0),model jsonb,
  failure_count integer not null default 0,error_message text,
  lease_token uuid,lease_until timestamptz,lease_used_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(date_from=date_trunc('month',date_from)::date and date_to>=date_from and date_to<date_from+interval '1 month')
);
create index wb_promo_jobs_period_idx on public.wb_promo_jobs(shop_id,date_from,created_at desc);
create unique index wb_promo_jobs_one_active_idx on public.wb_promo_jobs(shop_id,date_from) where status='loading';
alter table public.wb_promo_names enable row level security;
alter table public.wb_promo_viewers enable row level security;
alter table public.wb_promo_jobs enable row level security;
revoke all on public.wb_promo_names,public.wb_promo_viewers,public.wb_promo_jobs from public,anon,authenticated;
grant all on public.wb_promo_names,public.wb_promo_viewers,public.wb_promo_jobs to service_role;

create function public.wb_promo_queue_month(p_month date,p_refresh boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare shop constant uuid:='853b81a0-e0e2-4195-bc80-1cdc362af946';
  current_month date:=date_trunc('month',now() at time zone 'Europe/Moscow')::date;
  today date:=(now() at time zone 'Europe/Moscow')::date; finish date; old record; result uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month<current_month-interval '11 months' or p_month>current_month then raise exception 'Invalid month'; end if;
  if not exists(select 1 from public.shops s join public.wb_api_connections c on c.shop_id=s.id where s.id=shop and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261' and (c.expires_at is null or c.expires_at>now())) then raise exception 'Not connected'; end if;
  perform pg_advisory_xact_lock(hashtextextended('wb-promo:'||p_month::text,0));
  finish:=least(today,(p_month+interval '1 month - 1 day')::date);
  select * into old from public.wb_promo_jobs where shop_id=shop and date_from=p_month and status='loading' order by created_at desc limit 1;
  if found then return old.id; end if;
  select * into old from public.wb_promo_jobs where shop_id=shop and date_from=p_month and date_to=finish order by created_at desc limit 1;
  if found and (not p_refresh or (old.status='complete' and old.updated_at>now()-interval '1 hour')) then return old.id; end if;
  insert into public.wb_promo_jobs(shop_id,date_from,date_to,finance_period)
    values(shop,p_month,finish,case when p_month=current_month then 'daily' else 'weekly' end) returning id into result;
  return result;
end; $$;

create function public.wb_promo_accept_lease(p_job_id uuid,p_lease uuid)
returns setof public.wb_promo_jobs language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  return query update public.wb_promo_jobs j set lease_used_at=now()
    where j.id=p_job_id and j.shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946'
      and j.status='loading' and j.lease_token=p_lease and j.lease_until>now() and j.lease_used_at is null
      and exists(select 1 from public.wb_api_connections c join public.shops s on s.id=c.shop_id where c.shop_id=j.shop_id and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261' and (c.expires_at is null or c.expires_at>now()))
    returning j.*;
end; $$;

create function public.wb_promo_commit_page(p_job_id uuid,p_lease uuid,p_expected_cursor text,p_expected_rows integer,p_model jsonb,p_complete boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare changed integer; saved public.wb_promo_jobs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if not coalesce(p_model->>'version'='1' and jsonb_typeof(p_model->'buckets')='array'
    and (p_model->>'row_count')::integer>=p_expected_rows and (p_model->>'covered_rows')::integer<=(p_model->>'row_count')::integer
    and (p_model->>'cursor_id')::bigint>=p_expected_cursor::bigint,false) then raise exception 'Invalid aggregate'; end if;
  if p_complete and ((p_model->>'covered_rows')::integer<>(p_model->>'row_count')::integer or coalesce((p_model->>'unallocated_rows')::integer,-1)<>0) then raise exception 'Incomplete coverage'; end if;
  update public.wb_promo_jobs set model=p_model,cursor_id=(p_model->>'cursor_id')::bigint,row_count=(p_model->>'row_count')::integer,
    status=case when p_complete then 'complete' else 'loading' end,failure_count=0,error_message=null,updated_at=now()
    where id=p_job_id and shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946' and status='loading'
      and lease_token=p_lease and lease_until>now() and lease_used_at is not null
      and cursor_id=p_expected_cursor::bigint and row_count=p_expected_rows returning * into saved;
  get diagnostics changed=row_count;
  if changed=1 and p_complete then
    -- Generated compact snapshots only. Never delete financial models or files.
    delete from public.wb_promo_jobs where shop_id=saved.shop_id and date_from=saved.date_from and status='complete'
      and id not in(select id from public.wb_promo_jobs where shop_id=saved.shop_id and date_from=saved.date_from and status='complete' order by created_at desc,id desc limit 2);
  end if;
  return changed=1;
end; $$;

create function public.wb_promo_dispatch() returns integer
language plpgsql security definer set search_path='' as $$
declare chosen record; capability uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('wb-promo-dispatch',0)) then return 0; end if;
  if not exists(select 1 from public.wb_api_connections c join public.shops s on s.id=c.shop_id
    where c.shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946' and s.owner_id='bbb002c4-cd7a-490d-b9c0-72aed5424261'
      and c.next_request_at<=now() and (c.expires_at is null or c.expires_at>now())) then return 0; end if;
  if exists(select 1 from public.wb_api_preview_jobs where shop_id='853b81a0-e0e2-4195-bc80-1cdc362af946' and status='loading') then return 0; end if;
  if exists(select 1 from public.wb_promo_jobs where lease_until>now()) then return 0; end if;
  select id into chosen from public.wb_promo_jobs where status='loading' order by date_from desc,created_at limit 1 for update skip locked;
  if not found then return 0; end if;
  capability:=gen_random_uuid();
  update public.wb_promo_jobs set lease_token=capability,lease_until=now()+interval '10 minutes',lease_used_at=null where id=chosen.id;
  perform net.http_post(url:='https://qhvrdqcixglxopwrzeha.supabase.co/functions/v1/wb-api',
    headers:=jsonb_build_object('Content-Type','application/json','X-WB-Promo-Lease',capability::text),body:=jsonb_build_object('job_id',chosen.id),timeout_milliseconds:=120000);
  return 1;
end; $$;
revoke all on function public.wb_promo_queue_month(date,boolean),public.wb_promo_accept_lease(uuid,uuid),public.wb_promo_commit_page(uuid,uuid,text,integer,jsonb,boolean),public.wb_promo_dispatch() from public,anon,authenticated;
grant execute on function public.wb_promo_queue_month(date,boolean),public.wb_promo_accept_lease(uuid,uuid),public.wb_promo_commit_page(uuid,uuid,text,integer,jsonb,boolean),public.wb_promo_dispatch() to service_role;
select cron.schedule('wb-promocode-history','* * * * *','select public.wb_promo_dispatch();');
