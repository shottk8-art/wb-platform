-- Private seller-wide Retry and a shared conservative analytics burst slot.
-- Separate ordinary finance cadence from analytics so history cannot starve
-- inventory. These columns and functions are never exposed to client roles.
alter table public.wb_api_connections
  add column upstream_blocked_until timestamptz not null default '-infinity',
  add column next_analytics_at timestamptz not null default '-infinity';

create function public.wb_api_defer_request(p_shop_id uuid,p_seconds integer,p_limited boolean default true)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  if p_seconds is null or p_seconds<0 then raise exception 'Invalid delay'; end if;
  update public.wb_api_connections set
    next_request_at=greatest(next_request_at,now()+make_interval(secs=>p_seconds)),
    upstream_blocked_until=case when p_limited then greatest(upstream_blocked_until,now()+make_interval(secs=>p_seconds)) else upstream_blocked_until end
    where shop_id=p_shop_id;
  if not found then raise exception 'Not connected'; end if;
end; $$;

create function public.wb_api_claim_analytics(p_shop_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare next_allowed timestamptz; seconds integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Forbidden'; end if;
  select greatest(next_analytics_at,upstream_blocked_until) into next_allowed
    from public.wb_api_connections where shop_id=p_shop_id for update;
  if not found then raise exception 'Not connected'; end if;
  seconds:=case when next_allowed>now() then ceil(extract(epoch from next_allowed-now()))::integer else 0 end;
  if seconds>0 then return seconds; end if;
  -- The funnel and stock methods allow 3/minute, interval 20s, burst=1.
  -- A common 21s slot is intentionally conservative across these methods.
  update public.wb_api_connections set next_analytics_at=now()+interval '21 seconds' where shop_id=p_shop_id;
  return 0;
end; $$;

revoke all on function public.wb_api_defer_request(uuid,integer,boolean),public.wb_api_claim_analytics(uuid) from public,anon,authenticated;
grant execute on function public.wb_api_defer_request(uuid,integer,boolean),public.wb_api_claim_analytics(uuid) to service_role;
