// Trace extraction: turns coloured trace pixels inside the graticule into per-column
// y positions (image px) for each active channel.
//
// Result per channel: { mid, lo, hi, raw, blockW, found, alt? }
//   mid   = representative y per image column (Float32Array indexed by image x, NaN = none),
//           smoothed over one sample block (see below)
//   raw   = unsmoothed per-column y
//   lo/hi = topmost / bottommost pixel of the chosen run (vertical extent in that column)
//   alt   = persistence only: second branch where the waveform population splits (same shape) or null
//
// Pipeline per channel:
//   1. classify pixels (channel hue window, or "graded" colours in persistence mode)
//   2. split each column into runs (pixels closer than 0.75 div merge, which also bridges
//      white cursor lines drawn over the trace and the hollow sample blocks), then track
//      the run that continues the trace from the biggest run outward (skips labels,
//      markers and other far-away blobs)
//   3. y per column: run centre (normal) or the best continuous path through the heat map
//      (persistence: blue = rare ... red = frequent, see "persistence" below)
//   4. sample blocks: at fast timebases the scope draws each ADC sample as a block
//      several px wide; we detect the block width and box-filter over it, which equals
//      linear interpolation between sample centres
App.traces = (() => {
  const { rgb2hsv, median } = App.util;

  function extract(img, calib) {
    const out = {};
    const g = calib.grid;
    const x0 = Math.max(0, Math.ceil(g.left) + 1), x1 = Math.min(img.width - 1, Math.floor(g.right) - 1);
    const y0 = Math.max(0, Math.ceil(g.top) + 1), y1 = Math.min(img.height - 1, Math.floor(g.bottom) - 1);

    // Pre-compute HSV for the grid area once.
    const W = img.width, d = img.data, N = W * img.height;
    const hue = new Float32Array(N), sat = new Float32Array(N), val = new Float32Array(N);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, p = i * 4, hsv = rgb2hsv(d[p], d[p + 1], d[p + 2]);
      hue[i] = hsv.h; sat[i] = hsv.s; val[i] = hsv.v;
    }
    // Sample blocks are drawn as hollow rectangles up to ~0.7 div tall: merge runs closer than this.
    const mergeGap = Math.round(0.75 * App.calib.pxPerDivY(calib));
    const box = { W, width: img.width, x0, x1, y0, y1, mergeGap };

    for (const c of App.calib.CHANNELS) {
      const ch = calib.channels[c.id];
      if (!ch || !ch.on) continue;
      if (calib.persistence && calib.persistChannel === c.id) {
        const isHeat = i => sat[i] >= 0.4 && val[i] >= 0.3 && (hue[i] <= 240 || hue[i] >= 300);
        out[c.id] = persistenceTrace(box, trackRuns(box, isHeat), i => (isHeat(i) ? heat(hue[i]) : -1));
      } else {
        const match = i => sat[i] >= c.minSat && val[i] >= 0.25 && hue[i] >= c.hue[0] && hue[i] <= c.hue[1];
        const tr = trackRuns(box, match);
        out[c.id] = finish(tr, (x, r) => (r.a + r.b) / 2);
      }
    }
    return out;
  }

  /** Steps 1+2: per-column runs and continuity tracking. Returns {chosen: Array(width) of run|null}. */
  function trackRuns({ W, width, x0, x1, y0, y1, mergeGap }, cls) {
    const runs = new Array(width);
    for (let x = x0; x <= x1; x++) {
      // Matching pixels closer than mergeGap form one run.
      const r = []; let cur = null;
      for (let y = y0; y <= y1; y++) {
        if (!cls(y * W + x)) continue;
        if (cur && y - cur.b - 1 <= mergeGap) { cur.b = y; cur.n++; }
        else { cur = { a: y, b: y, n: 1 }; r.push(cur); }
      }
      runs[x] = r;
    }
    const chosen = new Array(width).fill(null);
    let seedX = -1, seed = null;
    for (let x = x0; x <= x1; x++) for (const r of runs[x]) if (!seed || r.n > seed.n) { seed = r; seedX = x; }
    if (!seed) return { chosen };
    const pick = (x, prev) => {
      let best = null, bd = Infinity;
      for (const r of runs[x]) {
        const dd = prev < r.a ? r.a - prev : prev > r.b ? prev - r.b : 0;
        if (dd < bd || (dd === bd && r.n > best.n)) { bd = dd; best = r; }
      }
      return best ? { r: best, d: bd } : null;
    };
    const walk = (from, to, step) => {
      let prev = (seed.a + seed.b) / 2, gap = 0;
      for (let x = from; step > 0 ? x <= to : x >= to; x += step) {
        const p = pick(x, prev);
        // Reject far jumps unless the trace has been lost for a while (then re-acquire).
        if (!p || (p.d > 40 && gap < 12)) { gap++; continue; }
        chosen[x] = p.r; prev = (p.r.a + p.r.b) / 2; gap = 0;
      }
    };
    walk(seedX, x1, 1);
    walk(seedX - 1, x0, -1);
    return { chosen };
  }

  /** Steps 3+4. */
  function finish({ chosen }, centreOf) {
    const width = chosen.length;
    const raw = new Float32Array(width).fill(NaN), lo = new Float32Array(width).fill(NaN), hi = new Float32Array(width).fill(NaN);
    let found = 0;
    chosen.forEach((r, x) => { if (r) { raw[x] = centreOf(x, r); lo[x] = r.a; hi[x] = r.b; found++; } });
    const blockW = detectBlockWidth(chosen);
    return { mid: blockW > 1 ? boxFilter(raw, blockW) : raw, raw, lo, hi, blockW, found };
  }

  /** Width of sample blocks: columns in a block share an identical (a,b) run. Returns 1 if none. */
  function detectBlockWidth(chosen) {
    const lens = [];
    let len = 0;
    for (let x = 1; x < chosen.length; x++) {
      const p = chosen[x - 1], r = chosen[x];
      if (p && r && p.a === r.a && p.b === r.b && r.b - r.a >= 3) len++;
      else { if (len >= 2) lens.push(len + 1); len = 0; }
    }
    if (lens.length < 5) return 1;
    // +1: the bright transition column at the end of each block belongs to the period.
    return Math.round(median(lens)) + 1;
  }

  function boxFilter(src, w) {
    const out = new Float32Array(src.length).fill(NaN), h = (w - 1) / 2;
    for (let x = 0; x < src.length; x++) {
      if (isNaN(src[x])) continue;
      let s = 0, n = 0;
      for (let k = Math.ceil(x - h); k <= Math.floor(x + h); k++) if (k >= 0 && k < src.length && !isNaN(src[k])) { s += src[k]; n++; }
      // half-weight the two edge columns for even widths so the window is exactly w wide
      if (w % 2 === 0) {
        for (const k of [x - w / 2, x + w / 2]) if (k >= 0 && k < src.length && !isNaN(src[k])) { s += src[k] * 0.5; n += 0.5; }
      }
      out[x] = s / n;
    }
    return out;
  }

  // Heat score of a persistence colour: blue 0 ... cyan .25 ... green .5 ... yellow .75 ... red 1.
  function heat(h) {
    if (h >= 300) return 1;          // magenta/red wrap-around
    if (h > 240) return 0;
    return 1 - h / 240;
  }

  // ---------------------------------------------------------------- persistence
  // The trace is the best continuous path through the heat map (dynamic programming over
  // columns: maximise sum of heat² along the path minus a small cost per px of vertical
  // movement). Unlike a per-column "hottest pixel" rule this never averages between two
  // ridges and carries through faint columns. A second pass with the first path masked out
  // finds a second branch where the waveform population splits (kept as `alt`).
  const EMPTY = -0.05;   // score of a pixel without trace colour
  const STEP = 0.04;     // cost per px of vertical movement between columns
  const MASK_R = 5;      // px around the first path excluded from the second pass
  const weight = h => 0.05 + h * h;   // path score and centre weight of a pixel with heat h >= 0

  /** Heat-weighted centre of column x within ±3 px of y (y itself if nothing is hot there). */
  function heatCentre(W, x, y, heatAt) {
    let sw = 0, sy = 0;
    for (let k = y - 3; k <= y + 3; k++) { const h = heatAt(k * W + x); if (h >= 0) { const w = weight(h); sw += w; sy += w * k; } }
    return sw ? sy / sw : y;
  }

  function persistenceTrace(box, { chosen }, heatAt) {
    const { W, width, x0, x1 } = box;
    const hasHeat = new Uint8Array(width);
    for (let x = x0; x <= x1; x++) hasHeat[x] = chosen[x] ? 1 : 0;
    const score = (x, y) => { const h = heatAt(y * W + x); return h < 0 ? EMPTY : weight(h); };

    const p1 = ridgePath(box, hasHeat, score);
    const tr = pathTrace(box, p1, hasHeat, chosen, heatAt);
    const p2 = ridgePath(box, hasHeat, (x, y) => (Math.abs(y - p1[x]) <= MASK_R ? EMPTY : score(x, y)));
    tr.alt = altTrace(box, p1, p2, hasHeat, heatAt);
    return tr;
  }

  /** Viterbi over columns with L1 transition cost (two-pass distance transform, O(W·H)). */
  function ridgePath({ width, x0, x1, y0, y1 }, hasHeat, score) {
    const H = y1 - y0 + 1, nx = x1 - x0 + 1;
    let D = new Float32Array(H), N = new Float32Array(H);
    const f = new Float32Array(H), arg = new Int32Array(H), back = new Int16Array(nx * H);
    for (let x = x0; x <= x1; x++) {
      for (let y = 0; y < H; y++) { f[y] = D[y]; arg[y] = y; }
      for (let y = 1; y < H; y++) if (f[y - 1] - STEP > f[y]) { f[y] = f[y - 1] - STEP; arg[y] = arg[y - 1]; }
      for (let y = H - 2; y >= 0; y--) if (f[y + 1] - STEP > f[y]) { f[y] = f[y + 1] - STEP; arg[y] = arg[y + 1]; }
      const off = (x - x0) * H;
      for (let y = 0; y < H; y++) { N[y] = f[y] + (hasHeat[x] ? score(x, y + y0) : 0); back[off + y] = arg[y]; }
      [D, N] = [N, D];
    }
    let y = 0;
    for (let k = 1; k < H; k++) if (D[k] > D[y]) y = k;
    const path = new Float32Array(width).fill(NaN);
    for (let x = x1; x >= x0; x--) { path[x] = y + y0; y = back[(x - x0) * H + y]; }
    return path;
  }

  /** Refine a path to a heat-weighted centre (±3 px) and attach the column envelope as lo/hi. */
  function pathTrace({ W, width, x0, x1 }, path, hasHeat, chosen, heatAt) {
    const mid = new Float32Array(width).fill(NaN), lo = new Float32Array(width).fill(NaN), hi = new Float32Array(width).fill(NaN);
    let found = 0;
    for (let x = x0; x <= x1; x++) {
      if (!hasHeat[x]) continue;
      mid[x] = heatCentre(W, x, path[x], heatAt);
      const r = chosen[x];
      lo[x] = Math.min(r.a, mid[x]); hi[x] = Math.max(r.b, mid[x]); found++;
    }
    return { mid, raw: mid, lo, hi, blockW: 1, found };
  }

  /** Second branch: only columns where it is hot and clearly apart from the first path. */
  function altTrace(box, p1, p2, hasHeat, heatAt) {
    const { W, width, x0, x1 } = box;
    const ok = new Uint8Array(width);
    for (let x = x0; x <= x1; x++)
      ok[x] = hasHeat[x] && Math.abs(p2[x] - p1[x]) > MASK_R + 2 && heatAt(p2[x] * W + x) >= 0.45 ? 1 : 0;
    // drop short fragments
    for (let x = x0; x <= x1;) {
      if (!ok[x]) { x++; continue; }
      let e = x; while (e <= x1 && ok[e]) e++;
      if (e - x < 15) ok.fill(0, x, e);
      x = e;
    }
    let n = 0;
    const mid = new Float32Array(width).fill(NaN), lo = new Float32Array(width).fill(NaN), hi = new Float32Array(width).fill(NaN);
    for (let x = x0; x <= x1; x++) if (ok[x]) { mid[x] = lo[x] = hi[x] = heatCentre(W, x, p2[x], heatAt); n++; }
    return n >= 30 ? { mid, raw: mid, lo, hi, blockW: 1, found: n } : null;
  }

  /**
   * y of a trace at image column x (searches +-3 columns if the column is empty).
   * lo/hi span the drawn band over one sample block around x = the display's uncertainty.
   */
  function yAt(trace, x) {
    if (!trace) return null;
    const xi = Math.round(x);
    for (let k = 0; k <= 3; k++) for (const s of k ? [xi - k, xi + k] : [xi]) {
      if (s < 0 || s >= trace.mid.length || isNaN(trace.mid[s])) continue;
      let lo = trace.lo[s], hi = trace.hi[s];
      const h = Math.floor(trace.blockW / 2);
      for (let j = s - h; j <= s + h; j++) {
        if (j < 0 || j >= trace.lo.length || isNaN(trace.lo[j])) continue;
        lo = Math.min(lo, trace.lo[j]); hi = Math.max(hi, trace.hi[j]);
      }
      return { mid: trace.mid[s], lo, hi, x: s };
    }
    return null;
  }

  return { extract, yAt };
})();
