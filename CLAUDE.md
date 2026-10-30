# Scope Screenshot Analyzer: context for Claude Code

The user does not read the code and works from two machines (this OneDrive folder + git). This file
and the docs it imports are the shared context; auto memory does not sync, so durable knowledge goes here.

## Purpose
Offline browser tool for measuring on oscilloscope data. **`index.html` (analyzer)** loads R&S RTB2004
screenshots, detects the screen layout, reads timebase / V/div / 0 V levels by OCR, extracts the traces and
offers draggable cursors (Δt, ΔV, slew rate, multi-period frequency); it also loads CSV waveform exports
(scope, LTspice) and merges them into one plot. **`dpt.html` (DPT Sweep)** collects double-pulse-test shots
from many folders and plots slew rate, overshoot and ringing against current, gate resistor or any parameter.
User guide: [README.md](README.md).

**Direction:** the analyzer is meant to be published as a general tool. Only the RTB2004 is supported today;
the goal is support for more scopes and, eventually, auto-detection that works on any scope's screenshot.
Design changes so that they don't lock in RTB2004 assumptions (see "Scope-specific code" below).
The DPT page is not meant to become a polished public tool: it ships as a demo that users adapt to their
own setup by coding with an agent. Keep its code plain and its assumptions explicit rather than configurable.

## Run
- Nothing to install, no build, no server, no port: double-click `index.html` or `dpt.html` (opens as
  `file:///…`). Current Chrome or Edge. Works offline. Dev URLs: `index.html?demo`, `index.html?samples=N`.
- Online copy: GitHub Pages serves `main` of github.com/Paschwuerfler/Scope-Screenshot-Analyzer
  (https://paschwuerfler.github.io/Scope-Screenshot-Analyzer/, `?demo`, `/dpt.html`), so **pushing to `main`
  publishes**. Before that, bump the `?v=N` suffix on every `<script>`/`<link>` in `index.html` and `dpt.html` (same N).
- Tests: Windows PowerShell 5.1 + Edge/Chrome, nothing else. Run after every change; all must pass:
  `powershell -ExecutionPolicy Bypass -File tools\run_tests.ps1` · `tools\ui_test.ps1 -ShotDir <dir>` ·
  `tools\dpt_test.ps1` · `tools\dpt_ui_test.ps1 -ShotDir <dir>` (details: @docs/TESTING.md).
- Optional: Node ≥ 18 (tested 22.19) for the Playwright MCP server in `.mcp.json` (dev tooling only).

## Structure
- `index.html`, `dpt.html`: markup, help dialogs, script lists. `css/app.css` (shared), `css/dpt.css`.
- `js/` analyzer modules, each `App.<name>`: `util` (formatting, SI parsing) · `ocr` + generated
  `ocr_glyphs` · `calibrate` (pixel ↔ physical) · `layouts/` (`rtb2004.js`, registry) · `traces` (curve
  extraction) · `series` (CSV parsing, packing, plot helpers; also used by DPT) · `measure` (cursor maths) ·
  `state` (`App.docs`, IndexedDB, export/import) · `loaders` (drop/paste/pickers, DPT handoff) · `view`
  (canvas, cursors, zoom) · `overview` (CSV overview bar) · `ui` (panels) · `app` (wiring, shortcuts).
- `js/dpt/`: `edges` (edge metrics, pure maths) · `pool` (folders/shots, IndexedDB, import/export) · `plot`
  (canvas helpers) · `ui` (pool list, overlay, trend, table, dialogs) · `app` (actions, shortcuts, handoff).
- `tools/`: tests (CDP-driven), glyph and demo generators. `samples/`: ground-truth screenshots
  (`tools/samples.js`), CSVs, DPT folder `NOR45A24/`, large pool `dpt-pool-2026-10-30.json` (perf tests).
- `docs/ARCHITECTURE.md` (data model, data flow, coordinates, OCR, persistence) and `docs/EXTENDING.md`
  (new scope layout, measurement, samples): read before larger changes. Change map: @docs/CHANGE_MAP.md

## Instruments and data
No live connection to any instrument (no USB/serial/VISA/LAN). Inputs are files exported from the scope:
- **Screenshots**: R&S RTB2004, 1280×824 PNG, normal and persistence display. The geometry is hard-coded in
  `js/layouts/rtb2004.js` (graticule 39..1239 × 100..704 px, 12 × 10 div). Other scopes: manual calibration
  in the app, or add a layout (EXTENDING.md).
- **CSV/TXT/TSV**: first column time, up to 4 channels; headers like `C1 in V`, `C3 in A` set names and
  units. LTspice text exports are resampled to a uniform grid; only the first `.step` run is used.
- **DPT folders**: one file per channel `Sxx_C<n>.CSV`. The user's standard wiring is C1 = switch node,
  C3 = current probe (the defaults; changeable per folder). Adding a folder or pool warns when the sample
  rate differs from the pool or a channel is clipped (`pool.addWarnings`). The current probe must be set to unit A on the scope so the export reads `C3 in A`; the shot
  current is the plain mean of that column. Pool files: JSON `{app: 'dpt-pool', version: 1}`.
- **Storage** is per browser and machine: IndexedDB `scope-screenshot-analyzer` (session) and
  `scope-dpt-pool`, localStorage `dpt-prefs`. Moving data: Export/Import session or pool.

## Conventions and gotchas (do not change without asking)
- **Must work from `file://`**: classic `<script>` tags only, no ES modules, no `fetch` of local files, no
  workers from files. New files go into the script list(s) in dependency order: analyzer util → ocr →
  calibrate → layouts → traces → series → measure → state → loaders → view → overview → ui → app; DPT util →
  series → loaders → dpt/edges → pool → plot → ui → app; plus `tools/test.html` / `harvest.html` if tests need them.
- No dependencies: no npm packages, no CDNs. Third-party code only vendored in `lib/` with a pinned version.
- One global, `App` (test-only `SAMPLES`). Modules talk via `App.events` and the `App.docs` API, not via
  another module's DOM.
- Internal units are SI (s, V, A, Hz); format only for display (`App.util.formatSI/formatRange/formatRate`),
  parse input with `App.util.parseSI`.
- Docs that must survive reloads: fields in `PERSISTED` (`js/state.js`); runtime caches never. After
  changing a doc call `App.docs.touch(doc, 'cursors'|'calib'|'detect'|'notes'|'prefs')`, never IndexedDB directly.
- **Scope-specific code** belongs in `js/layouts/<scope>.js` (registry picks the best `match()` score).
  Known leaks still RTB2000-specific and global: channel hue windows `App.calib.CHANNELS` (`calibrate.js`,
  used by `traces.js` extraction and as display colours) and the persistence heat palette (`traces.js`).
  Adding a scope with other trace colours means moving these into the layout descriptor first.
- Auto-detected values carry a status `ok`/`warn`/`manual` shown as badges, so uncertain results stay visible.
- Style: 2-space indent, single quotes, small IIFE modules returning their API, a header comment per file,
  comments only where non-obvious. UI text English; every mouse action gets a keyboard path where sensible.
- Never hand-edit `js/ocr_glyphs.js` or `js/demo_image.js` (generated, see TESTING.md).
- Repo files use LF. Python text-mode writes on Windows produce CRLF; use the Edit tool or `newline='\n'`,
  check with `git ls-files --eol`.
- DPT performance (2026-10-30): one pool import = one save + one render (`pool.addBatches`); view selects
  redraw only what depends on them; a full `renderAll` costs ~110 ms with 273 shots, so keep it off hover
  and other frequent events. `edges.js` sorts Float64Arrays (exact results), keep it that way.
- Known fragile spots, left as they are: `touch(null, 'prefs')` emits `doc-updated` with no doc; `#calib`
  handlers assume an active doc; `view.js` sets `SPAD`/`HANDLE_W` as a side effect of `seriesView()`;
  session import does not wait between files (picker allows one file).
- Keep README.md (user-facing) and docs/ in step with behaviour and structure.

## Maintenance rule
Before finishing any task that changes architecture, commands, dependencies, file formats or instrument
interfaces, or that uncovers a new gotcha or decision: update this file (and the imported docs) in the same
change. Keep it under ~100 lines; put details in `docs/` and import them with `@docs/<file>.md`.
Do not rely on auto memory, because it does not sync between the user's machines.
