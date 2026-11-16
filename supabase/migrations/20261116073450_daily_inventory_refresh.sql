-- Healthy existing snapshots follow the new daily schedule without another
-- fetch. Preserve the original received time, active work and error retries.
update public.wb_stock_snapshots
set next_run_at=greatest(next_run_at,fetched_at+interval '24 hours')
where stage='idle' and error_message is null and fetched_at is not null
  and (lease_until is null or lease_until<now());
