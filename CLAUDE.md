# Scope Screenshot Analyzer: notes for agents

Browser app (vanilla JS, **no build step, no dependencies**) for measuring on oscilloscope
screenshots. The user opens `index.html` by double-click (file://). The user will come back with
change requests about button placement and measurement interaction details, so keep the UI code
easy to rearrange.

Read before larger changes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (data model, modules,
data flow, coordinates) and [docs/EXTENDING.md](docs/EXTENDING.md) (recipes: new scope layout,
new measurement, time-series import, UI controls). User guide: [README.md](README.md).

## Hard constraints
- **Must keep working from `file://`**: classic `<script>` tags only (no ES modules, no `fetch`
  of local files, no workers loaded from files). New files must be added to the script list
  in `index.html` (with the same `?v=N` cache-busting suffix as the others; bump N in all tags
  whenever publishing to GitHub Pages) (order matters: util → ocr → calibrate → layouts → traces → series → measure →
  state → loaders → view → overview → ui → app) and, if needed by tests, to `tools/test.html` / `tools/harvest.html`.
  `dpt.html` (DPT sweep page) has its own list: util → series → loaders → dpt/edges → dpt/pool → dpt/plot →
  dpt/ui → dpt/app; bump its `?v=N` together with `index.html`.
- Everything hangs off the global `App` namespace (`App.util`, `App.ocr`, `App.calib`,
  `App.layouts`, `App.traces`, `App.series`, `App.measure`, `App.store`, `App.docs`, `App.loaders`,
  `App.view`, `App.ui`, `App.events`; DPT page: `App.dpt.edges/pool/plot/ui/app`). No globals besides `App` (and test-only `SAMPLES`).
- No third-party libraries unless vendored into `lib/` with a pinned version. No CDNs (offline use).
- Physical units internally are SI base units (s, V, Hz). Format only at display time with
  `App.util.formatSI / formatRange / formatRate`. Parse user input with `App.util.parseSI`.
- Persisted doc fields are listed in `PERSISTED` in `js/state.js`. If you add a field that
  must survive reloads, add it there. Runtime caches (bitmap, imgData, traces, view) must not be.
- After changing a doc, call `App.docs.touch(doc, what)` (`'cursors'` | `'calib'` | `'detect'`)
  so that it is re-rendered, re-extracted if needed, and saved. Don't write to IndexedDB directly.

## Where to change what
| Request | Place |
|---|---|
| Button placement, toolbar, panel layout | `index.html` (markup), `css/app.css` (grid: header / strip / stage / panel; widths `--strip-w`, `--panel-w`; rows below 3:2 aspect, `--panel-h`). The stage/panel splitter (`initSplitter` in `js/ui.js`) overrides `--panel-w/-h` and stores them in `App.ui.prefs` |
| Keyboard shortcuts | `KEYS` in `js/app.js` + help table in `index.html` |
| Cursor look, dragging, hit areas, zoom/pan, pick modes | `js/view.js` |
| Readout table / calibration form / thumbnails / status bar | `js/ui.js` |
| Cursor maths, future auto-measurements (slew 20–80 %, overshoot, ringing) | `js/measure.js` |
| Trace extraction from pixels | `js/traces.js` |
| Scope layout detection / OCR regions | `js/layouts/<scope>.js`, registry `js/layouts/index.js` |
| OCR engine / glyphs | `js/ocr.js`; glyphs are generated, see below |
| Loading inputs (drop, paste, pickers) | `js/loaders.js` |
| CSV parsing, auto scale, plot drawing helpers | `js/series.js`; plot + time-only zoom in `js/view.js`, overview bar `js/overview.js` |
| Merging CSVs into one plot (strip drag, dialog, Recordings / time shift) | `js/ui.js` (`initStripDrag`, `openMerge`, `recordingsHtml`); data: `App.series.combine`, `App.docs.addMerged/remerge`; Ctrl+drag shift in `js/view.js`. See ARCHITECTURE "Merged views" |
| Persistence, export/import | `js/state.js` |
| DPT sweep page: layout / controls | `dpt.html`, `css/dpt.css`, `js/dpt/ui.js` (views, dialog), `js/dpt/app.js` (actions, `KEYS`) |
| DPT edge metrics (slew, overshoot, ringing, levels) | `js/dpt/edges.js` (pure maths, tested by `tools/dpt_test.html`) |
| DPT pool: folder pairing, parameters, persistence | `js/dpt/pool.js` |

## Verify every change
Run from the project root in PowerShell (needs Edge or Chrome installed, nothing else):
- `powershell -ExecutionPolicy Bypass -File tools\run_tests.ps1`: detection/calibration/trace
  regression on all `samples/` against `tools/samples.js` (must print `ALL PASSED`).
- `powershell -ExecutionPolicy Bypass -File tools\ui_test.ps1 -ShotDir <folder>`: drives the
  real UI over CDP (drag, nudge, double-click, navigate, reload/restore) and saves screenshots
  into `<folder>` so you can look at them. Extend it when you change interactions.
- `tools\cdp.ps1` has helpers (`Start-CdpSession`, `Invoke-CdpJs`, `Send-CdpMouse`,
  `Send-CdpKey`, `Save-CdpScreenshot`) for ad-hoc UI checks. `index.html?samples=N` replaces
  the session with the samples and selects image N; `index.html?demo` loads the built-in demo
  screenshot (`js/demo_image.js`, regenerate with `toolsuild_demo.ps1`).
- DPT page: `powershell -ExecutionPolicy Bypass -File tools\dpt_test.ps1` (edge metrics, must print
  `ALL PASSED`) and `tools\dpt_ui_test.ps1 -ShotDir <folder>` (UI over CDP with `samples/NOR45A24`).
- If OCR glyphs or samples change: `powershell -ExecutionPolicy Bypass -File tools\build_glyphs.ps1`
  regenerates `js/ocr_glyphs.js` (never edit that file by hand).

Gotchas: PowerShell variables are case-insensitive (`$S` and `$s` are the same variable).
Headless `--dump-dom` with `--virtual-time-budget` is unreliable for the async app, so use the CDP
scripts. A browser profile inside the sandboxed scratch dir may have non-working IndexedDB,
so the CDP helper uses `%TEMP%`.

## Conventions
- Match the existing style: 2-space indent, single quotes, small IIFE modules returning a public
  API, short header comment per file explaining its role, comments only where non-obvious.
- UI text is English. Every mouse interaction should have a keyboard path where sensible.
- Calibration values carry a status (`ok` / `warn` / `manual`) shown as badges. New auto-detected
  values should follow the same pattern so that uncertain results are visible to the user.
- Update `README.md` (user-facing) and the docs when behaviour or structure changes.
