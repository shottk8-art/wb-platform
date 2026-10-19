---
version: 1
slug: "app-html"
primary_target: "app.html"
related_targets: ["assets/corbel.css","assets/corbel.js"]
---

# Кабинет продавца — Corbel reference reconstruction

Mode: Operate. User-pinned reference: https://demo.codeandchill.store/corbel/#/dashboard, inspected dashboard and settings/profile on 19 October 2026. Code-led, independently authored; no paid template source is copied.

## Direction contract

THESIS: The user superseded every previous visual rule. Reconstruct Corbel's actual page composition and component family; keep only the existing technical product and real WB/Ozon data.

OWN-WORLD: Measured Corbel palette, typography, 66px header, 264px rail, compact 16px panels and native motion. Instrument Sans body and Bricolage Grotesque display/numbers, with Cyrillic coverage retained. Both light and dark themes. No obsolete Apple treatment, mandatory Manrope identity, invented template data or fake shop score.

STORY: Select a shop and marketplace, read verified monthly profit and expenses, click a KPI to inspect its trend, manage imports and costs, then configure API, tax and access. Profile displays the real Telegram identity; appearance is local, not a fake saved account update.

FIRST VIEWPORT: Reference-aligned topbar with section icon, title, theme/profile tools; shop and search in the rail; four primary KPI cells only. Directly below, a half-circle profitability gauge on the left and reference-style monthly bars on the right. Advertising/DRR follows, then expenses and SKU: paired on a sufficiently wide workspace, stacked otherwise. Every important existing metric remains available.

FORM: User-pinned Corbel reference, code-led, no concept tournament. KPI-to-chart selection, travelling menu, masked headings, radial theme and compact rail follow the reference. Gauge is the real net-profit/sales ratio, never an invented performance score. Russian labels and working account/API/import controls remain. Fresh full finish review compares reference captures and build captures, not only isolated bug fixes.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Constraints: preserve all data isolation, accounting, API, Ozon import, AI owner restriction, empty/loading/error states and existing interactive IDs. User files and untracked duplicate assets stay untouched.

## Analytics pair layout

When the actual analytics section reaches1100px, place expenses on the left (minimum460px, .9fr) and SKU on the right (1.2fr), with a16px gap and aligned top edges. Keep natural card heights, no blank stretched panels. Ring maximum180px in the paired expense panel; legend/comparisons remain beside it and retain every category. Give compact SKU rank/quantity/revenue stable44/90/138px columns, a flexible product column and16% relative-revenue bar. Expanded financial columns still scroll internally. Below1100px keep the original single column; expense cards below440px place the ring above the legend. Container-aware layout also follows sidebar collapse and zoom; no DOM reordering, new animation, service read or financial change. Apply to cabinet and public file-based storefront in both themes.

## Shop selector refinement

Unify the rail's shop name and existing marketplace metadata inside the same native-backed select trigger. A36px initials tile identifies the actual selected shop; the name remains one ellipsized line with its full native title, existing WB/Ozon metadata is muted below, and the chevron remains right-aligned. The whole64px-high control is clickable, with one12px border radius and a200ms surface/border transition, no lift or new navigation. Keep the original shopSwitch select, marketplaceBadge node, options, change handlers, keyboard/disabled/empty states and data-isolation logic. Compact rail shows only the same monogram in a52px control; mobile drawer retains the full selector. Both themes/reduced-motion required. No server, storage, financial or permission changes.

## Month range extension

Keep the established Corbel composition. Add Month/Range controls and labelled start/end month selectors to the overview toolbar. Range affects every analytical total, expense category, SKU and chart; compare against the immediately preceding interval of equal calendar-month length. Preserve unknowns, recompute ratios from totals, reject incomplete monthly coverage, and suppress comparisons for the current partial month. Keep monthly editing/AI and refresh actions monthly, with a concise explanation in range mode. No schema, auth, permissions or upstream synchronization changes. Cover desktop and 390px layouts in both themes; keyboard controls reuse existing selects.

## Expense component extension — Traffic sources

The user's newer pinned component is Analytics → Traffic sources, replacing the earlier Total visits arrangement. Put the segmented ring on the left and the single-column legend on the right. Rows show a 10px swatch, category, right-aligned percentage and a muted signed ruble amount below. Retain our prior-period comparisons as secondary information, not invented traffic data. At rest the ring centre shows the true expense total; hover/focus/tap shows the category share and name. Selected segments scale to 1.045 around the ring centre; other segments dim to .28, the row uses surface-2. Leaving a row or segment restores the total and all segments. SVG geometry matches the inspected viewBox180/r70/stroke18 with adaptive gaps for very small real categories. Preserve every category, unknowns, signed corrections and month/range comparisons. Mobile stacks a180px ring over readable rows. Both themes and keyboard/reduced-motion paths required. No source, financial formula, service or access changes.

Motion thesis: linked row/ring focus is the focal moment. A bounded ring reveal, 420ms segment transform/opacity and 200ms row tint establish continuity; percentage-to-percentage counts use one interruptible360ms loop. Changing between rubles and percentages uses a short text reveal rather than interpolating incomparable units. No request, storage write, chart redraw or perpetual animation on hover. Cancel old animation/observers on source replacement and settle immediately for hidden documents or reduced motion.

## SKU component extension — Analytics Top products

Replace the separate SKU bar chart with the user-pinned Analytics Top products table: rank, a34px pastel initials tile, product name with muted article/ABC, bought quantity, bold ruble revenue and a6px relative-to-leader revenue bar. Preserve every product, search, ABC filters, sorting, totals and previous-period comparisons; this is not a top-six truncation. Compact mode shows the reference's core columns; a working “Все показатели” control discloses cost and gross-profit columns, and “Фильтры” discloses the existing controls. No fake product links or images. Both themes follow the reference's surface-2 row hover (150ms), no row lift; small screens keep all figures in labelled rows without page overflow. Negative, zero and unknown values stay truthful; only known positive revenue draws a positive bar, with no minimum fake fill. Financial formulas, API/tenant/source/month/range logic stay unchanged. Motion thesis: the thin revenue bars explain relative contribution; reveal only the first12 bars with one bounded760ms transform animation and capped150ms stagger, cancelled on rerender/hidden/reduced-motion. Final data is visible without animation and hover makes no request.

## Trend interaction extension — Revenue

Reproduce the inspected Revenue interaction inside the existing Chart.js trend: one travelling rounded highlight and white cap, a three-row tooltip at the plot top, animated values and a bold active month. User amendment: the tooltip is hidden at rest and disappears when the pointer leaves the chart, focus leaves its months, or Escape is pressed; hovering, focusing or tapping a month reveals it again. Pointer leave restores the selected period without showing the tooltip or running hidden counters; touch and arrow/Home/End keys inspect actual months. Add the reference-style average guide and compact period summary without changing the selected data, KPI-to-chart link, range, source or formulas. Tooltip uses the selected metric, actual bought quantity (sales for the quantity metric), and previous-calendar-month comparison, never fictional orders, forecasts or missing-year comparisons. Unknowns stay unknown; current partial months do not compare to a full month; DRR period guides use summed advertising/base, not averaged percentages. Both themes, negative/zero/sparse series and reduced-motion must work. Motion is bounded, interruptible and local; no reads, sync or paid analysis on hover. Keep native line mode and all existing financial access rules.

Motion thesis: the travelling highlight is the focal moment. Its horizontal position and height preserve continuity between months; bold labels and aligned changing values provide feedback. Use one isolated CSS transform/height transition plus one interruptible 450ms number loop, never per-frame canvas updates or network calls. Initial, hidden-document and reduced-motion states settle immediately.

## QUALITY BAR

The pinned Corbel dashboard and profile screenshots are the comparative standard, not an invitation to reinterpret the product. Match the shell proportions, four-cell KPI composition with lower comparison/minichart area, aligned 365px gauge/bar panels, compact profile identity/field grid and small appearance switch. Preserve the same hierarchy in both themes and a usable 390px layout. Quantitative visuals must use actual monthly series, a zero baseline for bars, meaningful precision and explicit missing-data states. Motion follows the measured reference with reduced-motion support; static screenshots alone do not prove full motion fidelity. No demo data or unsupported account tools may be added to the production UI.
