# End-to-end suite

Run with `npm run test:e2e`.

Specs are grouped by the audience they describe, and `playwright.config.js`
gives each project a `testMatch` list covering only the folders that apply to
it. A spec's folder is the single source of truth for where it runs — no spec
inspects `testInfo.project.name` at runtime, so a full run reports **zero
skips**. If a run reports a skip, something is genuinely being skipped.

## Project-to-folder mapping

| Folder     | `chromium` | `mobile-iphone-14` | `mobile-pixel-7` |
| ---------- | :--------: | :----------------: | :--------------: |
| `shared/`  |     ✅     |         ✅         |        ✅        |
| `desktop/` |     ✅     |         —          |        —         |
| `mobile/`  |     —      |         ✅         |        ✅        |
| `iphone/`  |     —      |         ✅         |        —         |

- **`shared/`** — behavior that must hold on every viewport: accessibility
  fundamentals, the calendar, the dashboard, and its summary tiles.
- **`desktop/`** — behavior that only exists on the desktop layout, such as the
  anchored calculator dropdown and the always-visible global nav.
- **`mobile/`** — the mobile shell (header, drawer, sub-navigation), which must
  hold on both phone profiles.
- **`iphone/`** — touch- and iOS-specific interaction coverage that is expensive
  to run twice and does not vary by phone: the bottom-sheet calculator,
  prediction sliders, the tank game, and the standings cards.

## Adding a spec

Pick the folder that matches where the behavior actually exists and put the
whole file there. A file that would need two different folders is two files —
splitting it keeps the run skip-free. Do not reintroduce `test.skip()` for
project applicability; it hides coverage gaps behind a number that looks
intentional.
