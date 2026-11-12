# Private Ozon advanced analytics

The immutable Karl account gate and ordinary shop authorization remain required.
Daily profit and unit economics use the manually uploaded Ozon accruals workbook;
no Ozon API credentials, WB source substitution or shared expense allocation.
The existing Corbel chart, hover/focus tooltip, comparison, table, sorting,
per-unit ledger, themes and reduced-motion behavior are reused.

`ozon-model.js` aggregates signed amounts in integer kopecks during parsing.
Only daily group totals/quantities and monthly article group totals survive.
Workbook IDs, postings and source rows are not persisted. The declared workbook
period controls coverage: partial reports do not fabricate a full month.

Daily profit is total net accruals minus COGS and sales tax, before manual
operating/external promotion costs. Advertising is already in net accruals and
must never be subtracted again. Returns restore COGS at the shared current shop
price. Missing cost makes the applicable profit/cumulative result unknown.

Unit profit includes only article-linked accruals, COGS and tax. All unassigned
fees, advertising and adjustments stay in the common ledger. DRR uses the exact
article-linked `Продвижение и реклама` group divided by that article's sales.
Refunds and compensations retain their signs. Range ratios use summed money;
missing months and gaps between partial reports cannot look complete.

The private `import_ozon_report` RPC atomically replaces affected monthly reports,
SKU sales, cost-card seeds, upload journal and `ozon_analytics_months`. Manual
monthly costs and existing catalogue prices survive. Other accounts use the
existing file flow and cannot call this private import or analytics routes.
No direct authenticated/anonymous table grants. Journal undo cascades only its
linked snapshots; source writes by older clients invalidate details immediately,
while manual monthly expenses do not invalidate them. Live tax/COGS are applied
on read. The shared client cache distinguishes shop and marketplace; Ozon warms
two recent report months without requiring a WB connection and ignores WB sync
notifications. Old responses cannot repaint a new source/context.

Earlier uploads retained monthly totals only. They require one re-import to add
detail. The originally supplied September TOPLASH workbook was backfilled after
exact monthly and per-article quantity/sales checks against its existing journal,
without rewriting financial reports, prices or manual expenses. The real workbook
contained 267,031 accrual rows; its compact model was under 40 KB serialized.

Checks: `ozon-analytics.mjs`, `ozon-upload.mjs`, `ozon-analytics.sql` (rollback),
`daily-analytics-ui.mjs`, `unit-economics-ui.mjs`, `wb-api-stock-routes.mjs` and
existing WB regressions. `ozon-layout-preview.mjs` serves synthetic UI only at
localhost:4193 for desktop/mobile/theme checks. These are browser checks, not a
physical-phone or live second-account login test.
