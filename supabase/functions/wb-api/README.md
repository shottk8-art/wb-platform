# WB API production integration

Every authenticated shop owner can connect a personal WB token (acc=3, not
sandbox) in Settings. WB verifies it; local JWT claims are not authentication.
`access.ts` authorizes each action against the exact shop owner or linked member.
Only owners connect/check/disconnect credentials. Team members can read and
update their shop's business data, matching existing file-report permissions.
Public storefront visibility never grants private API access. AI permissions
are unchanged. Ozon remains file-based.

Deploy `wb-api` and apply `20261011120000_wb_api_production.sql` on top of the
previous migrations before publishing the frontend. Keys stay encrypted in
Vault. Client roles have no direct table, key or worker-RPC privileges. Browser
requests require `auth.getUser()`; disabling gateway JWT verification does not
disable application authentication. Status reads never decrypt credentials.

Connect queues only that shop's current and eleven previous months. The private
pg_cron/pg_net dispatcher runs every minute, handling at most four shops fairly
by next-request time and one job per seller. History reconciliation is bounded
to ten shops per tick and at most hourly per shop. Expired connections are not
queued or leased. Leases are random, expiring, single-use server capabilities;
the service-role worker cannot be triggered using a browser/anonymous key.

Monthly stages: finance -> orders -> internal advertising -> WB Media. Finance
uses daily reports for the current month, weekly for closed months, ID-based
pagination, integer kopecks and deduplication. Cursor/totals commit together.
Conservative 63-second scheduling and any longer WB Retry duration apply per
shop; replacing a key does not reset cooldown. Errors have bounded retries.
Closing the browser cannot stop the queue. `preview_step` remains read-only
for already-open legacy clients; no test controls are exposed in the interface.

Overview uses the familiar dashboard. Unconnected shops retain file results;
connected shops default to API unless the user chose files. WB source preference
is shop-scoped. Ozon always reads uploaded reports; combined mode sums selected
WB results and Ozon files, never API plus files for the same marketplace.
Refresh queues a replacement snapshot and preserves the previous completed
snapshot until ready. Pure cabinet/trend reads never call WB. Trend uses stored
finance aggregates and shared catalogue reads, not raw operation scans.

Profit uses actual retrieved financial values, live cost prices/tax, money-funded
advertising and manual operating/external promotion expenses. Missing costs or
sources stay unknown, not zero. Bonus advertising is reference-only. Advertising
already included in financial deductions is not deducted twice. API ingestion
inserts new SKU costs without replacing existing costs or names; it never writes
monthly_reports/sku_sales/uploads or changes Ozon imports. API data is not public.

Run `node tests/wb-api.mjs`, `node tests/wb-api-access.mjs` and the other `wb-api*`
regressions for handler, isolation, calculation, queue, read-budget and UI tests.

## WB Media expense-first selection

WB can return `не удалось получить id баннеров размещения` from interval
statistics even for a parent listed as completed (status 7). This error never
proves zero spend. Before requesting statistics, the worker checks the campaign
card for every status. Explicit zero lifetime expenses, or all placements
provably outside the requested month, skip interval statistics entirely.
Positive lifetime expenses are NOT booked as monthly spend: the worker still
requests actual interval expenses. Missing expense evidence also requests the
interval, so an unknown campaign is never silently excluded. Invalid statistics
leave the month incomplete, with bounded retries and private shape diagnostics
(no raw statistics, credentials or arbitrary upstream fields).

Finance, orders, internal advertising, accumulated media money and the cursor
survive recovery. Zero evidence is retained with its campaign; cursor and totals
still commit together. A worker tick processes at most five campaigns (five
card requests for zero-expense campaigns, at most six requests if the last
campaign needs interval statistics), preserving the personal-token limit.
`node tests/wb-api-media-completed.mjs` replays the observed February response;
`node tests/wb-api-media-diagnostic.mjs` checks safe failure metadata and retries.
