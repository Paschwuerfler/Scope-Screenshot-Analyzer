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

### DPT sweep page (`dpt.html`)

A separate page for comparing double-pulse-test shots. It loads the shared `js/util.js`,
`js/series.js` (CSV parsing, `strokeColumn`) and `js/loaders.js` (only `filesFromDataTransfer` /
`readEntry` for folder drops; files carry `relPath` so drops are grouped per folder), plus its own
modules under `App.dpt`:

```
 drop / Add folder ──► App.dpt.app.addFiles → group by folder        js/dpt/app.js
        │                └─ App.dpt.pool.draft(files, folder)          js/dpt/pool.js
        │                     pair Sxx_C<n> files → shots, parse, guess params
        ▼
 App.dpt.ui.openBatchDialog (roles, parameters, overrides) → pool.addDraft
        │                                                   (IndexedDB "scope-dpt-pool")
        ▼
 App.dpt.edges.analyze(switchNode, current, settings) per shot     js/dpt/edges.js
        │  → edges [{kind, n, t50, base, top, slew1090, …, warn}]
        ▼  'pool-changed'
 App.dpt.ui: pool list, overlay, trend plot, table                js/dpt/ui.js
        └─ canvas helpers (scales, ticks, axes, palettes)           js/dpt/plot.js
```

- `batch = { id, name, params: [{key, text, value, unit}], roles: {sw, cur}, added }`,
  `shot = { id, batchId, label, files: [{name, text}], current (override) | null, hidden }`.
  Parsed channels (`shot.cols`) and results (`shot.res`) are runtime only, rebuilt on load and when
  the analysis settings change (`pool.setSettings`). Multi-shot changes are saved in one transaction
  (`pool.updateShots`).
- `pool.addWarnings(items, skip)`: import checks shown in the batch dialog and after Import pool (sample
  interval of switch node / current differs from the rest of the pool; `res.clipped.sw/cur` from
  `edges.isClipped`, a run of ≥ 8 samples at the record's extreme).
- `pool.rows(edgeKey)` flattens the pool to one row per shot for one edge (`'rise1'`, `'fall1'`, …)
  with all parameters in `row.p` (`I`, `Folder`, batch params). Every view reads these rows.
- Edge detection: hysteresis at 30 / 70 % of the 2nd–98th percentile range on a 3-point smoothed
  signal, rejected when the range is below 20× the noise sigma. Each edge is then measured between
  its own levels (see README "DPT sweep").
- View settings live in `localStorage` (`dpt-prefs`), the pool in its own IndexedDB, separate from
  the analyzer session.
- Two kinds of hidden: `shot.hidden` (pool checkboxes, saved) and `tmpHidden` in `ui.js` (Hide on a
  folder / trend point / menu, `H`; a Set of shot ids, never saved). Views use `isOff(shot)` = either.
  Hiding also unpins (a pinned but undrawn shot would dim all others). Repeats are grouped the same way
  in trend (`trendPoints`), table (`tableEntries`) and pool list (`poolEntries`): shot name + all
  non-built-in parameter values; merged list items / rows carry `data-ids`, read with `rowIds()`.
  Pool list options (`prefs.poolCollapse`, `prefs.poolFolders`) and the per-folder filter count
  (`.flt-n`, `flt-part` / `flt-all` / `flt-none`) are rendered in `renderPool`.
- **Open in scope view** (context menu in `ui.js`, `openInScope` in `app.js`): the DPT page opens
  `index.html` as the named tab `scope-analyzer` and sends
  `{ type: 'scope-open', id, docs: [{ name, notes, csv, names, edge: {t1, t2, a, b} }] }` by `postMessage`
  (name and notes from `App.dpt.app.scopeLabel`; `openInScope(ids, true)` instead sends one doc from
  `overlayDoc`: the switch node of up to 4 repeat shots as C1..C4, interpolated onto the first shot's
  grid with their t50 of the selected edge aligned, cut to the common span)
  (works between file:// pages, no shared storage needed). The shot's channels are merged into one
  CSV. The analyzer (`App.loaders.initHandoff`, only when `window.opener` is set) posts
  `scope-ready` once its session is restored and `scope-ack` per payload; the DPT page resends
  until acked. Docs are matched by name, so reopening a shot reuses it.

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
| `userNotes` | yes | free text from the Notes card (`renderNotes` / `initNotes` in `js/ui.js`); DPT shots start with their parameters. Saved with `touch(doc, 'notes')`, which does not re-render |
| `parts` | yes | merged views only (`blob = null`): `[{name, blob, shift, map}]`, see "Merged views" |
| `bitmap, imgData, traces, thumbUrl, view` | no | runtime caches, rebuilt on load (series: `series, thumbUrl, view = {xa, xb}`; merged: `+ partData`) |

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

#### Merged views

A merged view is a series doc built from several recordings (`parts`). Each part stores its own file
blob, a time `shift` (s; `parts[0]` is the time reference with shift 0, the merge dialog normalises
this, so two files = one offset) and `map` (source column id → channel id in the view, at most C1..C4).
`App.series.combine(parts, partData)` builds `doc.series`: columns keep their own samples and get
their own timing `col.t0` (incl. shift) / `col.dt` / `col.part`, and the virtual sample grid spans
all parts at the finest dt (virtual, nothing is allocated per sample). So **never index `col.v` with
x directly**: read with `App.series.valueAt` (converts via `colIndex`) and draw with
`App.series.strokeSeries`. Everything else (cursors, calib, overview, readout) is unchanged.
- Created by `App.docs.addMerged` from the merge dialog (`App.ui.openMerge`: thumbnail dragged
  onto another, the ⧉ button or M). A merged doc brings its parts along when merged again.
- A shift change calls `App.docs.remerge(doc, final)`: rebuilds the grid and remaps cursors,
  multi-period marks and the window so they keep their times. Shifts are edited in the Display
  panel (Recordings), by Align at the cursors (either cursor order: `App.series.shapeMatch` decides which cursor marks the reference; undoable: `shifts` and `cursors` in the undo snapshot) or by
  Ctrl+drag on a curve in `App.view` (emits `doc-updated` with `'shift'` while dragging).
- Export / import store each part's blob separately (packed per part in the smaller formats).

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
JSON with images and CSVs as data URLs (`App.docs.exportSession(mode) / importSession`).
Above 1 MB (`EXPORT_ASK_BYTES` in `app.js`) the export dialog (`App.ui.askExport`) offers modes
`lossless` / `compact`, which replace CSV blobs by packed samples (`App.series.pack`: gzip via the
built-in `CompressionStream`, header JSON + byte planes; `f32` = XOR-delta float32, bit-exact;
`q16` = 16-bit delta, max error per column stored and shown as a doc note). A packed blob has type
`application/x-scope-series-<enc>` and stays packed in IndexedDB after import; `App.series.load`
reads either form. Exports containing packed blobs carry `version: 2`.
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
| `dpt_test.html` + `dpt_test.ps1` | DPT edge metrics on synthetic double pulses, parameter parsing, `samples/NOR45A24` |
| `dpt_ui_test.ps1` | DPT page over CDP: two folders through the dialog, hover / pin, edges, sort, hide / unhide, pool Collapse repeats, right-click → open in the analyzer tab (`Connect-CdpTarget`), reload |
