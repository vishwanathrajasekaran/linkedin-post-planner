# Regression checks

All fixtures are synthetic. Tests do not need credentials and never call Google or LinkedIn. The Apps Script `save_`, `readAll_`, and `bulk_` functions run against an in-memory Sheet adapter. Publishing uses a test stub, not LinkedIn.

## Dependency-free checks

From `linkedin-post-planner/`:

```bash
npm run check
npm test
```

`check` validates JavaScript syntax. The 45 logic tests cover JSON/CSV parsing, row-specific validation, timestamps, attachments, publication metadata, the 500-row limit, validation-before-save, unsaved-change cancellation, partial-import retry IDs, export/import round trips through the real backend save implementation, and isolated editor copies.

## Browser checks

Browser tests require Node 20+ and Playwright, installed separately from production dependencies. For a disposable local install:

```bash
npm install --no-save --package-lock=false playwright@1.64.1
npx playwright install chromium
npm run test:browser
```

If Microsoft Edge is installed, it can be used without downloading Chromium. In Git Bash:

```bash
BROWSER_CHANNEL=msedge npm run test:browser
```

Or in PowerShell:

```powershell
$env:BROWSER_CHANNEL = 'msedge'
npm run test:browser
```

An externally installed Playwright can instead be selected with `PLAYWRIGHT_MODULE` set to its absolute module directory. `TEST_SCREENSHOTS_DIR` optionally writes synthetic-data screenshots. The test server binds an ephemeral loopback port, serves only allowlisted application assets, blocks external requests, and shuts down afterward.

The 16 browser tests cover:

- Planner and Calendar at 320, 375, 390, 768, 900, 1024, 1280, 1440, and 1920px; narrow phone sizes also emulate mobile/touch.
- Expanded series, long/unbroken titles, editor attachments, and absence of horizontal overflow.
- Calendar day labels on one line, readable wrapped titles, aligned time chips.
- All five bulk actions, explicit Submit, required schedule, selected counts, select-all/indeterminate state, confirmations, and final deletion cleanup.
- Export disclosure, Escape/outside dismissal, focus restoration, and real JSON/CSV downloads.
- Import picker, zero-write invalid-file rejection, JSON/CSV saves, reopening and reloading saved posts.
- Mobile editor-first order, New/Edit/Calendar navigation, text focus, scrolling, unsaved cancellation, and published read-only behavior.
- Dark theme and mobile feed preview. Every browser test checks for uncaught page errors.

Optional original-code reproduction (before committing these changes): `TEST_BASELINE=1` serves `HEAD` versions of `app.js` and `styles.css`. The layout and Calendar assertions should fail against the original code; this is not part of the passing suite.

## Verification scope

Verified locally on October 20, 2026 using Node 24.15.0, Playwright 1.64.1 and headless Microsoft Edge 155.0.4283.62. No live LinkedIn publishing, production deployment, Google OAuth, or real Sheet writes are covered. Phone emulation is not an on-device Safari/Android browser test. There is no configured compilation, lint or TypeScript step in this project.
