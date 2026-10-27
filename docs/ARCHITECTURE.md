# Architecture

## Overview

```
 input (drop / paste / pickers / session import)          js/loaders.js
        │ File / Blob
        ▼
 App.docs.addImage ──► decode (ImageBitmap + ImageData)    js/state.js
        │
        ├─► App.layouts.detect(img)  → best layout or none js/layouts/index.js
        │       └─ layout.analyze(img) → calib, status,     js/layouts/rtb2004.js
        │                                notes, raw OCR     (uses js/ocr.js)
        ├─► App.traces.extract(img, calib) → per-channel    js/traces.js
        │                                    y per column
        ├─► default cursors
        └─► save to IndexedDB (debounced)                   App.store in js/state.js
 App.docs.addSeries ──► parse CSV, auto scale               js/series.js (see "Series docs")
                    │
 events: docs-changed / active-changed / doc-updated / hover / zoom / window / mode / toast / busy
                    ▼
 App.view (canvas: image or plot + overlays + cursors)      js/view.js
 App.overview (CSV only: whole-recording bar above plot)    js/overview.js
 App.ui   (thumbnails, readout, calibration form, status)   js/ui.js
        └─ both read App.measure.cursorReadout(doc)         js/measure.js
```

`js/app.js` wires buttons and keyboard shortcuts and calls `App.docs.restore()` on start.
Modules talk through `App.events` (tiny pub/sub in `js/util.js`) and the `App.docs` API, never
through the DOM of another module.

## Data model

A **doc** is one loaded screenshot (`js/state.js`):

| Field | Persisted | Meaning |
|---|---|---|
| `id, name, kind ('image' \| 'series'), blob, width, height, addedAt` | yes | identity and source (image, or CSV text for series) |
| `layoutId, layoutName` | yes | detected layout, `null` = unknown (manual calibration) |
| `calib` | yes | calibration, see below |
| `status` | yes | `{time:{tdiv,tCenter}, channels:{C1:{vdiv,zeroY}}, grid}` with `'ok'|'warn'|'manual'` |
| `notes, raw` | yes | human-readable detection notes, raw OCR strings (shown in the panel) |
| `chNames` | yes | `{C1: 'Vout', ...}` custom channel names (series: defaults from the CSV headers, `App.series.autoNames`); display them with `App.calib.chLabel(doc, id)` → `C1 (Vout)` |
| `axisCh` | yes | series: channel whose values label the y axis, set by the last interaction (see `App.series.axisChannel`) |
| `cursors` | yes | `{x1, x2, sel, periods, probe}`: `probe` = ids of the channels the cursors read (missing = default, see `App.measure.probedChannels`); cursor positions in **image px**, `sel` = keyboard target, `periods` = multi-period mode `{p0, x1}` (reference period and cursor-1 anchor in image px) or null |
| `bitmap, imgData, traces, thumbUrl, view` | no | runtime caches, rebuilt on load (series: `series, thumbUrl, view = {xa, xb}`) |

### Series (CSV) docs

`js/series.js` parses the CSV into `doc.series = { t0, dt, n, cols: [{id, name, unit, v}] }` and
gives the doc a **virtual image**: x = sample index (`width = n`), y = a fixed 800 px graticule
with 10 × 8 divs. `calib.time` maps sample index → time exactly; `calib.channels[ch].vdiv/zeroY`
are the *display* scale and offset (set by Auto scale or the Display panel). Because of this,
cursors (in sample index), the readout, multi-period mode and persistence are shared with
screenshots unchanged. The only branches on `doc.kind === 'series'`:
- `App.measure.valueAtX` / `traceToSeries` read the samples (linear interpolation), not pixels;
- `App.view` draws a plot (`drawSeries`, min/max envelope per screen column via
  `App.series.strokeColumn`) and uses separate x/y scales: the graticule always fills the
  height, `doc.view = {xa, xb}` is the visible sample window (wheel zooms time only);
- `js/overview.js` (`App.overview`) is the bar above the plot that pans/resizes that window;
- `App.docs.analyze` = auto scale, `retrace` is a no-op, `hydrate` re-parses on restore/import;
- `App.ui` shows the Display panel instead of the calibration form.

`calib` (`js/calibrate.js`):
```js
{
  grid:     { left, right, top, bottom, hdiv, vdiv },   // graticule in image px
  time:     { tdiv, tCenter },                           // s/div, time at horizontal grid centre
  channels: { C1: { on, vdiv, unit, zeroY }, ... },      // scale per div, y (image px) of the 0 level
  persistence, persistChannel,                           // colour-graded display mode
  selected                                               // channel whose scale the axis labels show
}
```

`traces[ch]` = `{ mid, raw, lo, hi, blockW, found, alt? }` (`alt`: second branch of a split persistence trace, same shape). `mid`/`lo`/`hi` are Float32Arrays indexed
by image x (NaN = no trace in that column). `mid` is smoothed over one sample block.

## Coordinate systems

- **Image px** (`ix, iy`): pixel coordinates in the screenshot. Everything stored uses these.
- **Screen px** (CSS px in the canvas): `sx = view.ox + ix * view.scale`; see `toScreen/toImage` in `view.js`.
- **Physical**: `App.calib.tAt(calib, ix)`, `xAt(calib, t)`, `vAt(calib, ch, iy)`, `yAt(calib, ch, v)`.
  Time: `t = tCenter + (ix − gridCentreX) / pxPerDivX · tdiv`. Value: `v = (zeroY − iy) / pxPerDivY · vdiv`.

## Layout detection & calibration (RTB2004)

`js/layouts/rtb2004.js` knows the fixed screen geometry (graticule 39..1239 × 100..704 px,
12 × 10 div) and fuses several sources, each reported with a status:

| Value | Primary source | Cross-check |
|---|---|---|
| time/div, centre time | x-axis labels under the grid (bitmap font, robust line fit over up to 11 labels) | header boxes "5 ns/", "20 ns" (anti-aliased font) |
| active channels | bottom-bar label squares (gray = off, coloured = on, bright = selected) | |
| V/div per channel | bottom-bar text "10 v/" | y-axis labels (only the selected channel) |
| 0 V level | coloured channel marker at the left edge | y-axis labels (selected channel). Hidden markers (two channels with the same offset) fall back to the visible marker, flagged `warn` |
| persistence mode | many saturated blue pixels inside the grid | |

### OCR (`js/ocr.js`)
- **Bitmap engine**: fixed-pitch 5×11 cells (pitch 6 px), Hamming distance to templates. Used for axis labels.
- **Anti-aliased engine**: segment glyphs by blank columns, describe each by a 10×14 intensity
  raster plus geometry relative to the font size (`em`) and baseline, so templates work across
  font sizes. Unknown glyphs become `?`, with geometric fallbacks for `-`, `.` and `µ`.
- Templates live in `js/ocr_glyphs.js`, **generated** by `tools/harvest.html` from `samples/`
  and the ground truth in `tools/samples.js` (`tools/build_glyphs.ps1`). Characters not present
  in any sample are hand-drawn in `tools/synthetic_glyphs.js` (`m µ u p k A .` for the bitmap font)
  until a real sample exists.

### Trace extraction (`js/traces.js`)
1. Classify pixels: channel hue window (`App.calib.CHANNELS`), or "graded" colours in persistence mode.
2. Per column, group matching pixels into runs (gaps < 0.75 div merge, which bridges white cursor
   lines and the hollow sample blocks the RTB draws at fast timebases).
3. Track the trace from the largest run outward, picking the run nearest to the previous one
   (rejects labels, markers, cursor numbers).
4. Normal traces: y per column = run centre; detect the sample block width and box-filter over it
   (= linear interpolation between sample centres).
   Persistence: the trace is the best continuous path through the heat map, found by dynamic
   programming over columns (score = heat², small cost per px of vertical movement, so detours
   to hot-coloured labels don't pay off while real edges cost every path the same). It never
   averages between two ridges. A second pass with the first path masked finds a second branch
   where the waveform population splits; it is kept as `trace.alt` (only hot, ≥ 15-column
   segments clearly apart from the main path) and shown as "C4 ②" in the readout and dashed
   in the detection overlay. Tuning constants: `EMPTY`, `STEP`, `MASK_R` in `traces.js`.
5. `yAt(trace, x)` returns `mid` plus the band `lo..hi` over one block, which the UI shows as uncertainty.

Accuracy on the samples: the scope's own cursor readouts lie within ~1.5 V (10 V/div) of the
extracted centre value and always inside the displayed band (`tools/test.html` checks this).

## Persistence

IndexedDB database `scope-screenshot-analyzer` (version 1):
- store `docs` (keyPath `id`): serialized docs including the image Blob
- store `meta`: key `session` → `{ order: [ids], activeId, ui: prefs }`

Saving is debounced (400 ms) per doc. If IndexedDB is unavailable or does not answer within
4 s, the app keeps working and shows a toast suggesting Export. Session export/import is
JSON with images as data URLs (`App.docs.exportSession / importSession`).
Schema changes: bump `DB_VERSION` in `App.store` and migrate in `onupgradeneeded`; for doc-level
changes add defaults when restoring in `App.docs.restore`.

## Tests & tools (`tools/`)

| File | Purpose |
|---|---|
| `samples.js` | ground truth for `samples/*.png` |
| `test.html` + `run_tests.ps1` | detection / calibration / trace regression (headless) |
| `harvest.html` + `build_glyphs.ps1` | regenerate `js/ocr_glyphs.js` |
| `synthetic_glyphs.js` | hand-drawn fallback glyphs |
| `cdp.ps1` | Chrome DevTools Protocol helpers (PowerShell, no deps) |
| `ui_test.ps1` | end-to-end UI smoke test incl. persistence |
| `demo.js` | `index.html?samples=N` replaces the session with the samples (dev only) |
| `build_demo.ps1` | regenerate `js/demo_image.js` (embedded screenshot behind "Load demo" / `?demo`) |
| `headless.ps1` | find browser, dump an element of a headless-rendered page |
