# Private TOPLASH inventory pilot

Only the immutable Karl/TOPLASH identities used by the daily pilot are allowed.
The normal shop authorization runs first; the server additionally checks the
exact pilot pair. The DB snapshot and worker functions have no anonymous or
authenticated grants. The public storefront never loads this feature.

Sources, checked in the live official documentation on 12 November 2026:

- `POST /api/analytics/v1/stocks-report/wb-warehouses`: current available WB stock,
  client-bound and returning units, by nmId/chrtId/warehouseId.
- `POST /api/analytics/v1/stocks-report/seller-warehouses`: current available stock
  on seller warehouses, with a distinct warehouse ID namespace.
- `POST /api/analytics/v3/sales-funnel/products`: product identity and order counts
  over the last 28 completed Moscow calendar days, including cards with no orders.

WB inventory is updated every 30 minutes. One server cron runs bounded stages,
one upstream page per tick. It uses a random, single-use, expiring DB capability;
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
