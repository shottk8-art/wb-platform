---
version: 1
slug: "promocodes-html"
primary_target: "promocodes.html"
related_targets: ["assets/promocodes.css", "assets/promocodes.js", "assets/promo-range.js"]
---

# TOPLASH — статистика по промокодам

18 November 2026. **Mode: Operate.** Ordinary code-led extension of the accepted
Corbel platform; no approved comp, replacement visual world, new imagery, fonts or
dependencies. This brief scopes the separate `/promocodes.html` surface.

## Incumbent authority and visual extension

Prior comparison covered [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md), the
[sidecar](../design.json) and [cabinet brief](app-html.md) with the finished
[HTML](../../promocodes.html), [CSS](../../assets/promocodes.css),
[JavaScript](../../assets/promocodes.js) and then-current saved browser evidence.
The documentation approach follows the installed `impeccable/reference/document.md`;
this scoped extension requires no regeneration of global artifacts.

The parent inspected live [Corbel Customers](https://demo.codeandchill.store/corbel/#/customers)
in the current session. Its saved [reference](../review/promocodes-reference.png)
was inspected offline in this documentation pass. Adapt its compact statistics,
search/sort header and readable numeric list through the incumbent platform
components. The separate page has a compact TOPLASH/account header instead of the
cabinet rail, followed by period controls, four joined statistics, the promo table,
calculation explanation and an owner-only management disclosure.

Reuse semantic `page`, `panel`, `surface`, `surface-2`, `line`, `line-strong`,
`ink`, `ink-soft`, `ink-mute`, `brand`, `on-brand`, `accent`, `accent-soft` and
`bad` in both light and dark. Keep flat panels, thin borders, the existing mark,
16px cards, 24px desktop canvas and 9–10px controls. Shared `corbel.js` and
`corbel-motion.js` retain the platform theme preference and theme transition.
No surface-specific palette or separate theme store is introduced.

Instrument Sans remains the working stack, Bricolage Grotesque the heading/number
stack, with existing Manrope Cyrillic coverage. Local sizing is an extension:
page title 26px desktop / 22px mobile, metric 27px desktop / 24px below 1100px,
table 13px. Figures use tabular numerals. The unified range trigger and «Показать»
share a matching 44px height and baseline; at ≤520px Show stacks below the trigger.
Below 760px, statistics become 2×2, search/sort stack, and table rows become labelled two-column cards with
identity spanning both columns. Management stacks; long names, codes and IDs wrap.

## Main-app menu entry — 18 November 2026

The main `/app` sidebar now exposes «Статистика по промокодам TOPLASH» as a normal
`/promocodes.html` link through `assets/promo-navigation.js?v=20261118-menu1`.
This bounded extension replaces the old owner-account/selected-TOPLASH client
gate with authenticated, account-level `promocodes_access`: strict `allowed === true`
and fixed TOPLASH identity are required. Existing `authorizePromo` still admits
only the owner or explicit invitees; membership alone grants no promo access, and
feature-only invitees need no ordinary TOPLASH membership. The access DTO contains
only `allowed`, `owner`, `shop_id`; it reads no financial models and makes no WB call.

The link stays hidden during checking, denial or offline failure; tab return
rechecks access. Sign-out/account/token replacement clears it, with abort and
generation guards rejecting late old-session responses; initial auth events are
deduplicated. Selected-shop and ordinary-view changes do not hide or refetch it.
Corbel styles, fonts, icons and motion are unchanged. See the
[main-app menu evidence](app-html.md#toplash-promo-menu-extension--18-november-2026)
for the parent's current sidebar-only synthetic captures and six passing suites;
placeholder main content is not full-app verification. Actual invited production
login and physical phones remain unverified. The replacement independent reviewer
inspected current sources and all four sidebar captures and returned **SHIP for
this sidebar extension**, with no material fixes. Earlier catalogue/picker verdicts
remain separate and do not imply full-app approval.
Menu publication remains pending with the parent.

## Access and data meaning

- TOPLASH only. Telegram login precedes access; feature invitations activate
  against the server-verified Telegram username. A typed username or copied login
  link is not proof of identity. Grants confer access only to promo statistics;
  they never create shop membership or expose other shop data.
  An existing, bound TOPLASH member need not restart a Telegram session after
  invitation: the owner-managed same-shop member record can activate that explicit
  grant immediately or on its next promo read. A revoked invitation or one bound
  to another account is never recreated or reassigned by this resolution.
- Only the owner manages catalogue names/codes/IDs, grants/revocation and WB refresh. Viewers read
  promo data only; owner controls and the cabinet link are hidden for them.
  The server enforces these boundaries independently of the UI.
- Metrics mean financial-report buyouts: bought units and seller-price buyout
  value, not all placed orders, payout or profit. The date basis is the financial
  operation's `rrDate`. Returns have their own operation dates, units and value;
  the period net is buyout value minus return value and may be negative.
  Current operations appear only once WB includes them in its financial report.
- Scope is only the promo list currently shown in WB Seller. The parent captured
  the entire list in connected Chrome and opened every card to read its visible
  financial-report ID, distinct from internal `data-row-key`. Initially 51 unique
  financial IDs with names/codes were verified and imported privately.
- `wb_promo_names` is both the names/code catalogue and a strict server allowlist:
  only its canonical IDs and explicitly verified historical aliases affect totals.
  Older financial operations can use the ID from the same card's URL; the private
  `wb_promo_id_aliases` table links that ID to the ID shown inside the card. They
  form one row, including returns; names/codes never infer a match, and conflicts
  fail closed. Unmapped financial IDs never return or affect totals. Catalogue IDs receive zero
  rows only with full-period coverage. Equal names/codes never merge different IDs.
- Finance API remains `uuidPromocode`-only; `sellerPromoId` is a different identifier.
  Names were initially copied from WB Seller; the owner maintains future entries
  through the existing Names disclosure, adding financial IDs via its form.
  Optional code input (64 characters maximum) is separate from name and ID;
  names/codes persist across periods without further manual period mapping.

## Periods, local interaction and states

The bounded picker extension in [promo-range.js](../../assets/promo-range.js)
replaces the two visible native date fields with one range trigger and a dialog.
The parent inspected live Corbel Analytics date-preset interactions this turn;
the extension retains the accepted platform tokens, typography and both themes.
Use native automatic popover behavior with a fallback when unsupported, two
calendar months on desktop and one on mobile. Fit available height with internal
scrolling and sticky actions.

Selection and manual entry update a local draft. Apply commits the range and
submits once; Cancel, Escape and outside dismissal make no query. Manual
`DD.MM.YYYY` entry autoformats eight numeric digits while retaining the caret,
so phone numeric keyboards need no literal dot key. Invalid dates disable Apply.
Presets cover 7 days, 30 days, current month and previous month. Month navigation
and roving keyboard focus support arrows, Home/End and PageUp/PageDown. Arbitrary
inclusive ranges retain the existing rolling 12-month min/max bounds and canonical
ISO `YYYY-MM-DD` values. Finance, server behavior and permissions are unchanged.

Search locally by name/code/ID; show code separately.
Sort by buyout value, units, net or name; paginate locally in pages of 50.
«Промокодов в списке» counts catalogue rows. Summary totals cover only the allowed
catalogue over the full period; matching count/pages follow search. Table money
retains cents; compact summary values retain exact amounts in titles.

Use one interruptible 450ms number-count loop. Context/session replacement cancels
it; hidden documents and reduced motion settle immediately. Row hover/focus uses
`surface-2` over 400ms without lift; reduced motion removes transitions. Search,
sort, paging and hover operate on the loaded result without WB requests. Keep
native labelled fields, table semantics, skip link, visible focus and live status.

Distinguish missing, loading, denied, network error, `needs_catalog` and ready data.
New-period reads, non-ready loading and sign-out clear old figures, titles and
rows; late responses cannot repopulate another session. Empty catalogue returns
`needs_catalog` and queues no work. Missing coverage offers owner preparation or
asks viewers to contact the owner; never imply zero activity before full coverage.
A ready result refreshing on the server may show its qualified last complete
snapshot and fetched time; it is not partial loading data.

Initial access status and the initial-read network retry live outside hidden
`#promoMain`: a first-load failure must stay visible and actionable. Denied access
keeps the main content hidden. A successful retry removes the access error and
reveals the result. Period errors remain visible near the period controls.

## Aggregation and request boundaries

Promo aggregation shares the ordinary financial ingestion pass. Compact one-time
historical backfill shares its quota; retain aggregates, never raw orders. UI
reads use prepared server aggregates without new WB reads; owner preparation/
refresh schedules quota-controlled work only with a catalogue. Per parent handoff,
October/November are prepared and the backend plus private code column are
migrated/deployed. The prior feature was published at `d14ae444`; publication of
this datepicker UI update awaits the parent. No live checks here.
Never commit real IDs, campaign names, codes, revenue or usernames in this brief.

## Evidence and review limits

The parent opened the final picker captures below with synthetic fixture data;
they were not reopened here. Catalogue captures remain prior feature evidence,
not current picker evidence. Earlier access/error captures still apply unchanged.

| Evidence | Scope |
| --- | --- |
| [Range toolbar](../review/promo-range-toolbar-final.png), [picker light](../review/promo-range-desktop-light-final.png), [dark](../review/promo-range-desktop-dark-final.png) | 1488×918; aligned trigger/Show and desktop dialog |
| [Picker mobile light](../review/promo-range-mobile-light-final.png) | 390×844 viewport crop |
| [Picker mobile dark](../review/promo-range-mobile-dark-320-final.png) | 320×640 viewport crop |
| [Desktop light](../review/promocodes-catalog-desktop-light.png), [dark](../review/promocodes-catalog-desktop-dark.png) | 2081×1079; catalogue extension in both themes |
| [Mobile light](../review/promocodes-catalog-mobile-light.png), [dark](../review/promocodes-catalog-mobile-dark.png) | 390×1400 viewport crops, not full-page evidence |
| [Owner management](../review/promocodes-catalog-management-mobile.png) | Partial 390×1000 crop: prefilled code and start of access section, not the whole form |
| [Initial error](../review/promocodes-initial-error.png), [retry recovery](../review/promocodes-retry-recovered.png) | Visible error/retry outside the hidden main, then recovered content |

Parent reports four targeted suites passed: [promo-range.cjs](../../tests/promo-range.cjs),
`promocodes-ui.cjs`, `promocodes-routes.mjs` and `wb-promocodes.mjs`. The earlier
84 distinct passing executables (87 executions including three duplicate runs)
remain prior catalogue evidence and were not rerun for this change. No tests ran here.

The picker reviewer's only P2 concerned numeric keyboards lacking literal dots.
Autoformat corrected it; the parent verified actual raw-digit browser entry and
the helper test. Final follow-up: **P2 resolved; SHIP for the whole bounded
datepicker change**, with no material issues remaining. That verdict uses source,
prior captures and reported checks; no recapture was required. The earlier
catalogue SHIP remains scoped to that extension. Actual invitee Telegram login,
physical-phone behavior, the live authenticated production picker and complete
motion fidelity remain unverified. Publication is still pending with the parent.

## Preexisting drift and scope

The sidecar's older SKU sample still describes a `panel` header and `accent-soft`
row hover, while later DESIGN/cabinet guidance specifies `surface-2` for the SKU
extension. Its older SKU-chart motion example also predates the documented table
replacement. Preserve those global artifacts; the promo page uses the scoped
table behavior above. The existing hook `dark-glow` finding belongs to the shared
legacy base, not new promo CSS. No detector rerun, ignore or repair was performed.

Only this and the main-app surface brief are updated in this menu documentation
pass. Global DESIGN, sidecar, config and other files remain untouched. Tests, commit and publication belong to the
parent task; this document supplies no separate publication authorization.
