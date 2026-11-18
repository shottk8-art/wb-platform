---
version: 1
slug: "admin-html"
primary_target: "admin.html"
related_targets: ["assets/admin-access.js", "assets/admin-access.css", "assets/section-access.js"]
---
# Admin section access

Bounded code-led Operate extension in the existing Corbel light/dark world.
The parent inspected live Corbel Settings/Profile and Team for implementation:
compact identity list, thin divided rows, labelled controls, calm surfaces and keyboard feedback.
Keep existing admin overview/questions/users/shops and immutable admin boundary.
No replacement world, new palette, imagery, fonts or libraries.

Add one discoverable "Доступы" anchor and a two-column user-list / section-switch
editor. On narrow screens stack both; list scrolls within a bounded height.
Show selected account, descriptions, saved/dirty/error state, explicit Save and
Cancel draft. Disable account switching during save, discard old async results
on selection/session change, lock administrator's always-full access.

Ten account-wide section flags preserve defaults and existing shop isolation.
Explicit promo grant gives only TOPLASH promo statistics; other section grants
do not create shop membership. Closed routes fail closed and service actions/RLS
respect permission checks. Preserve account/session data and real calculations.
No automatic permission changes to existing customers in migration.

Use platform semantic tokens, established type and flat panel rules. Compact
native checkbox switches, 44px rows/controls, focus, reduced-motion support.
Verify both themes, desktop and 390/320px, loading/error/locked account, save,
selection races, non-admin API denial, deny via direct routes and raw data reads.

## Final section-access corrections — 18 November 2026

**Mode: Operate.** The contract above is now implemented. This documentation pass
read actual scoped source, [PRODUCT.md](../../PRODUCT.md), [DESIGN.md](../../DESIGN.md)
and the installed `impeccable/reference/document.md`. Preserve the global Corbel
system, existing type, semantic themes and admin workflows; no approved comp,
new imagery, fonts, palette or libraries. Shared inherited glow is baseline
evidence only, with no global repair or detector suppression.

[admin.html](../../admin.html), [admin-access.js](../../assets/admin-access.js),
[its CSS](../../assets/admin-access.css) and [admin.js](../../assets/admin.js) provide
the searchable people list and ten labelled switches: `overview`, `daily`,
`stocks`, `reports`, `costs`, `team`, `settings`, `account`, `ai`, `promocodes`.
Selection/read/save results must match the actual server UID. Save commits the
complete map explicitly; Cancel restores the saved draft. Dirty selection changes
require discard confirmation; loading, read retry, save error and saved states
remain visible. Saving locks account selection; revision/session guards reject
late results. The administrator's own full map is immutable in UI and server.
Enabling AI also enables Overview; disabling Overview disables AI. If the editor
script fails, the existing admin remains usable with an inline recovery message.

Ordinary defaults retain Overview, Reports, Costs, Team, Settings and Account.
Daily/unit, Stocks and AI remain off for other accounts until explicitly granted.
Legacy promo invitations remain valid unless a central promo override replaces
them. Section grants apply across existing owned/member shops and never create
membership; an explicit promo-only grant is standalone fixed-TOPLASH read-only
access. Authority comes from server identity, never editable profile metadata.

Server enforcement is in [sections.ts](../../supabase/functions/wb-api/sections.ts),
the guarded endpoints and four migrations: `20261118180000_user_section_access.sql`,
`20261118180100_pending_promo_section_access.sql`,
`20261118180200_section_access_audit_index.sql` and
`20261118180300_section_mutation_boundaries.sql`. Shared financial reads support
permitted consumers; writes keep their section boundaries, detailed in the
[cabinet addendum](app-html.md#central-section-map--18-november-2026).

## Evidence and limits for this correction

The parent opened all final captures below; this pass checked local files and
dimensions without reopening the images. These use actual HTML/JS with synthetic
transport. Desktop AX/inspection images are scrolled viewports, not full-page.

| Evidence | Scope |
| --- | --- |
| [Desktop light](../review/admin-access-desktop-light.png), [dark](../review/admin-access-desktop-dark.png) | 1477×911 viewports |
| [Mobile light](../review/admin-access-mobile-light.png), [actions](../review/admin-access-mobile-actions-light.png) | 390×844 |
| [Mobile dark selector](../review/admin-access-mobile-selector-dark-320.png), [editor](../review/admin-access-mobile-dark-320.png) | 320×640 |
| [Read error](../review/admin-access-load-error.png), [save error](../review/admin-access-save-error.png), [locked admin](../review/admin-access-locked.png) | 1477×911 state captures |

The [cabinet addendum](app-html.md#central-section-map--18-november-2026) retains
the final account-only and promo-only captures. Parent-reported validation:

- 92 distinct offline executables passed; final correction targeted suites passed.
- Real transaction/rollback [section-access.sql](../../tests/section-access.sql)
  passed admin/non-admin and own-rule checks, metadata spoof rejection, atomic
  invalid saves, restrictive RLS, cost/report mutation and manual-expense UPSERT,
  member isolation and eligible workers. The 690-row / 477-article SQL regression
  also passed under an 8-second limit.
- Browser checks of actual markup/scripts with synthetic transport covered
  Save/Cancel/search, AI dependency, locked admin, errors, delayed selection,
  promo-only/account-only hash routes and immediate navigation on map revoke/grant.
- Four migrations were applied; after rollback QA, `user_section_access` had zero
  rows. No actual customer section flags were changed.

Fresh Hypatia review read actual source and 11 captures, initially returning
FIX for three findings. After correction the reviewer reopened four corrected
captures and reran two local suites: **SHIP / all three findings RESOLVED AT
FIX-LIST SCOPE**. This is not broad surface approval; earlier scoped reviews stay
historical. No physical-phone or invited real-account proof, complete motion
proof or paid WB/OpenAI calls are claimed. This documentation pass used no browser,
network or DB and reran no implementation tests. Only the three authorized surface
briefs are written; global DESIGN, sidecar, config and code are preserved.
Commit and deployment remain pending with the parent; no published version is asserted.
