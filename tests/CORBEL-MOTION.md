# Motion reconstruction, 19 October 2026

Reference: public https://demo.codeandchill.store/corbel/#/dashboard and `#/settings`.
Observed dashboard, settings tabs, compact sidebar, computed transitions and the
publicly served animation code. Independently implemented with browser-native
CSS/Web Animations/View Transitions; no GSAP bundle or paid template imported.

| Observable mechanism | Reference | Implementation |
| --- | --- | --- |
| Initial inset canvas | 1100ms, y22, scale .988, expo out | initial workspace entrance |
| Menu entries | 700ms, x−14, 22ms stagger | initial navigation reveal |
| Active menu pill | 650ms travel, stretch ≤1.55 | persistent travelling pill |
| Selected menu icon | 600ms, scale .7, rotation ±14°, 80ms delay | interruptible icon response |
| Heading | masked y110%, rotation5°, 800ms, 20ms/character | Russian word-safe letter reveal |
| View exit | 200ms, opacity0/y−10 | cancellable latest-route commit |
| View entry | 900ms, y26, scale .985, 70ms stagger | section entrance |
| Segmented pill | 550ms, expo out | real state-driven travelling pill |
| Theme | circle from trigger, 620ms, bezier(.65,0,.35,1) | native snapshot clip reveal |
| Compact sidebar | native View Transition | compact desktop rail, persisted locally |
| Mobile drawer | 500ms enter, 350ms exit, 18ms item stagger | CSS drawer plus item entrance |
| Dialog | desktop500ms/y18/scale.96; phone550ms sheet | question/new-shop surfaces |
| Dialog exit | desktop200ms, phone320ms | asynchronous visual close, no form submission |
| Tooltip | 400ms/y−8/scale.97 | existing explanatory popovers |
| Toast | 550ms/y18/scale.96 | existing notifications |
| Main metrics | 1200ms numeric interpolation, cubic out | existing real formatter/target values |

Exponential/back curves are native cubic-bezier approximations, not GSAP's
polynomial implementation. Our monthly chart is Chart.js, not Corbel's custom
SVG chart: it animates the existing real series, with bounded point/bar stagger.
No invented shopper counter, forecast, revenue score, notification feed or billing
screens: these have no corresponding platform data/function.

Reduced-motion skips spatial animation and deferred route commits. Browsers
without View Transitions switch themes/rail immediately. No animation fetches
data, delays API work, changes tenant access or recalculates financial formulas.
Each route exit cancels its predecessor; returning to the current view also
invalidates any queued destination. Per-element animation handles are weakly
held and replaced on interruption. No continuous animation loop is introduced.

Verification: local Chromium/iAB, desktop1440 and phone390 CSS-pixel emulation,
both themes, compact rail, route return, modal sheet and reduced-motion fixture.
No horizontal overflow or browser console errors observed. Not physical-device
or cross-browser certification. Regression suites cover latest-route commits,
completed exit effect removal, pending theme-choice races and preference changes
during modal closure. Independent scoped finish review found these three
lifecycle defects; all three are resolved and rechecked with disposition ship.
Financial, DRR, shop/source isolation, mobile renderer and read-budget tests pass.
