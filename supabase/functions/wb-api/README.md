# WB API pilot

Only the verified immutable auth ID of @karlshott may use the endpoint, and
only for shops owned by that account. The client-side gate is not authorization.

Apply `supabase/migrations/20261009190000_wb_api_test.sql` before deploying
`wb-api`. Keys are encrypted in Supabase Vault. Neither keys nor secret IDs are
returned by the function. Client roles have no table or RPC privileges. All RPCs
check `auth.role() = 'service_role'` in addition to explicit grants.

Actions: `status`, `connect`, `check`, `disconnect`, `preview_start`, `preview_step`.
All use POST with a valid Supabase access token; the function verifies it using
`auth.getUser()`. JWT gateway verification is disabled for compatibility with
asymmetric Supabase tokens, not to remove authentication.

The preview uses the current finance API, weekly reports, money as decimal
strings, and ID-based pagination. The server enforces a 63-second interval.
Only an empty/204 answer finalizes the report. Duplicate rows are upserted by
`(job_id, rrd_id)`; failed pages can be safely retried. The client waits between
requests without blocking the browser and stops polling on a shop change.

This version intentionally does not synchronize monthly_reports, sku_sales,
uploads, advertising or profit calculations, and has no background schedule.
Compare actual API categories to financial files before promoting the import.
The UI labels generic deductions as including advertising to avoid double counting.

Run `node tests/wb-api.mjs` for isolated handler and calculation tests.
