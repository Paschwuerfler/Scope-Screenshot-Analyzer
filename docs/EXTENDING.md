# Extending the analyzer

Each recipe ends with the same verification: `tools\run_tests.ps1` (must print `ALL PASSED`) and,
for UI changes, `tools\ui_test.ps1 -ShotDir <folder>`. Look at the screenshots it writes.

## Add a sample screenshot (improves OCR and tests)

1. Copy the PNG into `samples/` with a descriptive name.
2. Add an entry to `tools/samples.js` with what the scope screen shows: timebase, position,
   active channels with V/div and 0 V level (y in image px: `top + k · pxPerDivY` for grid line k),
   the selected channel, the exact header and bottom-bar texts, and the scope's own cursor readout
   if visible.
3. `tools\build_glyphs.ps1`: harvests glyphs; it logs `skip …` if a region's segmentation
   doesn't match the expected text (then the expected string is wrong or the region rectangle is off).
   New real glyphs replace synthetic ones automatically.
4. `tools\run_tests.ps1`.

Especially useful: screenshots with µs/ms timebases, mV scales, negative positions, `7`/`9` in the
header, other probe units (A), channel C2, side menu open, zoom/roll modes.

## Add a scope layout

1. Create `js/layouts/<id>.js` modelled on `rtb2004.js`, then call `App.layouts.register({...})` with
   - `id`, `name`
   - `match(img) → 0..1`: cheap fingerprint (image size, grid line positions, header colours).
     ≥ 0.5 counts as a match; the best score wins.
   - `analyze(img) → { calib, status, notes, raw }`: start from `App.calib.emptyCalib(w, h)`, fill
     `grid`, `time`, `channels`, `persistence`. Give every value a status (`'ok'` only if confirmed
     by two sources or a very reliable one, otherwise `'warn'`) and explain conflicts in `notes`.
2. Add `<script src="js/layouts/<id>.js">` to `index.html`, `tools/test.html`, `tools/harvest.html`
   (after `layouts/index.js`).
3. If the scope uses other fonts, the OCR engines are generic: export the regions/em sizes from
   the layout and extend `tools/harvest.html` to harvest them (it currently iterates RTB regions).
   Glyph templates from different fonts can coexist; consider separating them per layout if
   they collide (e.g. `App.GLYPHS.small_<layout>`).
4. If channel colours differ, extend `App.calib.CHANNELS` or make colours part of the layout.
5. Add samples + ground truth (above).

## Add an auto-measurement (slew 20–80 %, overshoot, ringing frequency, min/max, …)

All measurement code belongs in `js/measure.js` and should operate on series
`{t: Float64Array, v: Float64Array}` so it works for screenshots and future imported data:

```js
const s = App.measure.traceToSeries(doc, 'C1');   // screenshot trace → series (SI units)
```

Suggested approach (sketch):
- **Levels**: low/high = histogram modes (or medians of the first/last 10 % of the record).
- **Rise/fall 20–80 % & slew**: find crossings of `low + 0.2·(high−low)` and `0.8·…` around the
  steepest edge, interpolate linearly between samples, slew = 0.6·(high−low)/(t80−t20).
- **Overshoot**: `(max after edge − high) / (high − low)`.
- **Ringing frequency**: after the edge, subtract `high`, find zero crossings (or peaks) and take the
  median period. FFT on the post-edge segment is an alternative.
- Return values together with an uncertainty when possible (e.g. from the trace band `lo/hi`).

UI: add a card (or rows) in `index.html` / `js/ui.js` similar to the cursor readout; drawing of
markers (e.g. 20/80 % levels, detected edge) goes into `js/view.js` (`draw*` functions). Add a toggle
in the stage toolbar if it clutters the image. Consider "place cursors at 20 %/80 %" as a button:
set `doc.cursors.x1/x2` via `App.calib.xAt` and `App.docs.touch(doc, 'cursors')`.

## Add time-series import (CSV etc.)

Implemented (see ARCHITECTURE.md, "Series (CSV) docs"). To support another export format, extend
`App.series.parse` in `js/series.js`: it must return `{ t0, dt, n, cols: [{id, name, unit, v}] }`
with uniform sampling (it resamples non-uniform time at the median step, max 4M points) and values
in SI units. Headers go through `parseHeader` (scope style `C1 in V`, SPICE style `V(out)`);
`readText` decodes UTF-16 files. `samples/csv/` holds example
files; `tools/ui_test.ps1` loads them through a file input.

## Add or move a UI control

- Markup in `index.html`; buttons use `data-act="<name>"` and are wired in `init()` of `js/app.js`.
- Toggle buttons (`.toggle` + `.on`) map to `App.ui.prefs` (persisted in the session meta) via
  `App.ui.togglePref(key)`. Read prefs in `view.js` via `prefs()`.
- Keyboard: add to `KEYS` in `js/app.js` and to the help dialog table in `index.html`.
- Panel content is rendered by `renderReadout` / `renderCalib` / `renderStrip` in `js/ui.js`
  (template strings; event delegation on the container).
- Canvas interaction (drag thresholds, hit areas, what double-click does, modifier keys) lives in
  `onDown/onMove/onUp/onDblClick` in `js/view.js`. New pick modes: `App.view.setMode({type:…})`
  and handle them in `onDown`.
- Colours/sizes: CSS tokens at the top of `css/app.css`; cursor colours `CURSOR_COLORS` in `view.js`.
