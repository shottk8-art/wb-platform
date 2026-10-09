# WB API pilot

Only the verified immutable auth ID of @karlshott may use the endpoint, and
only for shops owned by that account. The client-side gate is not authorization.
This is a private, personal-token integration for the account's own sellers,
not SaaS onboarding. Connect and worker paths accept personal WB tokens only
(acc=3, not sandbox). JWT claims do not authenticate a key: WB still verifies it.
Status returns only the key type and documented finance interval, never claims
or credentials. Seller-info/ping do not prove permission for report detail.

Apply `supabase/migrations/20261009190000_wb_api_test.sql` before deploying
`wb-api`. Keys are encrypted in Supabase Vault. Neither keys nor secret IDs are
returned by the function. Client roles have no table or RPC privileges. All RPCs
check `auth.role() = 'service_role'` in addition to explicit grants.

Actions: `status`, `connect`, `check`, `disconnect`, `preview_start`, `preview_step`.
All use POST with a valid Supabase access token; the function verifies it using
`auth.getUser()`. JWT gateway verification is disabled for compatibility with
asymmetric Supabase tokens, not to remove authentication.

Apply `20261009210000_wb_api_background.sql` after the pilot migration.
The preview uses the finance API, weekly reports, decimal strings, and ID-based
pagination (50,000 operations per page). A private pg_cron/pg_net dispatcher
checks due jobs every minute. Each worker request uses a random, single-use,
10-minute capability; `wb_api_accept_lease` is service-role-only and rechecks
the immutable pilot owner. Lease expiry recovers a terminated worker. Client
`preview_step` is now read-only for backward compatibility; status polling never
advances pagination. Closing the browser cannot stop the scheduler.

The server enforces 63 seconds or the longer WB `X-Ratelimit-Retry` duration
(seconds, including long Basic-token waits). Never shorten a genuine quota.
Only empty/204 finalizes. Duplicate rows upsert by `(job_id, rrd_id)`. Cursor and
partial totals update together, in exact integer kopecks; retries before cursor
commit replace rows safely. Older pilot jobs bootstrap totals from saved rows.
The next cursor is the last raw response row ID. Non-monotonic pages stop before
any data writes, instead of using a maximum ID that could skip financial rows.
Changing the key does not blindly reset an outstanding WB Retry cooldown.
Transient failures retry with bounded backoff (five attempts), credential/data
errors stop for operator review. Dispatch handles one job per seller at a time.
The history button requests data since 2024-01-29 through the last closed month;
this is provider-available history, not a promise of every financial category.

This version intentionally does not synchronize monthly_reports, sku_sales,
uploads, advertising or profit calculations.
Compare actual API categories to financial files before promoting the import.
The UI labels generic deductions as including advertising to avoid double counting.

Run `node tests/wb-api.mjs` for isolated handler and calculation tests.
