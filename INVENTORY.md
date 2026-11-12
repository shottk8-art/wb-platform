# Private account inventory pilot

Only the immutable Karl account is allowed, across its shops (12 November 2026).
Normal shop authorization runs first; the server additionally checks the exact
account identity. Background collection and DB helpers require Karl ownership. The DB snapshot and worker functions have no anonymous or
authenticated grants. The public storefront never loads this feature.

Sources, checked in the live official documentation on 12 November 2026:

- `POST /api/analytics/v1/stocks-report/wb-warehouses`: current available WB stock,
  client-bound and returning units, by nmId/chrtId/warehouseId.
- `POST /api/analytics/v1/stocks-report/seller-warehouses`: current available stock
  on seller warehouses, with a distinct warehouse ID namespace.
- `POST /api/analytics/v3/sales-funnel/products`: product identity and order counts
  over the last 28 completed Moscow calendar days, including cards with no orders.

WB inventory is updated every 30 minutes. One server cron runs bounded stages,
one upstream page per shop per tick. Dispatch selects at most eight due shops,
oldest first, with independent single-use leases. New connected owner shops are
discovered automatically; expired connections are skipped. It uses a random, single-use, expiring DB capability;
the browser never receives this capability or the WB key. Pagination is complete
before publication; an incomplete/error snapshot never replaces the last good
one. Only one compact snapshot and temporary in-progress state exist per shop.
There is no raw-order or inventory-history table. `stocks` reads do not call WB.
The browser pauses polling when hidden and reuses data for filtering/selection.

Available quantities exclude client transit. Coverage uses available stock from
all WB and seller warehouses divided by average daily orders. It is an estimate,
not a seasonal forecast; planned supplies are excluded. Default alert/target are
14/30 days and may be changed. Positive-demand stockouts and short coverage cause
notifications. Dormant zero-stock cards remain listed, without a replenishment
alarm. Zero/missing demand has no fabricated days or recommended quantity.
Warehouse filtering changes the displayed quantity; forecast/status explicitly
remain across all warehouses because warehouse-specific demand is not known.

Deploy the migration with its cron initially disabled, then deploy `wb-api`, then
enable `wb-stock-pilot`. The current production cron was enabled after the server
deployment. Disabling this cron pauses the pilot without touching finance.

Checks: `node tests/wb-api-stocks.mjs`, `node tests/wb-api-stock-routes.mjs`,
`node tests/stocks-ui.mjs`; DB lease/grant checks in `tests/wb-api-stocks.sql`
always roll back. `node tests/stocks-layout-preview.mjs` serves production UI with
explicitly synthetic inventory at localhost:4192 for responsive verification.

Excluded products are durable monitoring preferences in `wb_stock_tracking`,
independent of the API connection. Only their identity is retained, so removed
WB cards can still be restored. Exclusions omit stock from dashboard totals and
notifications, while source data and financial calculations stay intact. The
`stocks_tracking` action toggles one nmId atomically under the private gate; it
never overwrites another exclusion. Check `tests/wb-api-stock-tracking.sql`.

The same account scope covers daily profit, unit economics and article advertising.
Only the current and preceding month are automatically prepared by the existing
history reconciler; ready/active jobs are reused and no raw history is retained.
Existing incomplete aggregates show preparation rather than fabricated figures.
Other accounts, including team members, cannot enter these experimental routes.
Ozon stays on the existing file-import path; these API experiments use WB only.
Regression scope: `tests/private-feature-scope.mjs`, `tests/private-feature-scope.sql`
(rollback only), `tests/wb-api-stock-routes.mjs`, and both real frontend controllers.
