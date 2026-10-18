// OCR for the fixed fonts used in scope screenshots.
//
// Two engines, both driven by glyph templates in js/ocr_glyphs.js (App.GLYPHS),
// which are harvested from real screenshots by tools/harvest.html:
//
//  1. Bitmap engine ("small" font): fixed-pitch, non-anti-aliased pixel font used for
//     the axis labels on the graticule (e.g. "-5 ns", "60 V"). Each character occupies
//     a fixed cell (pitch 6 px, glyph 5 px wide, 11 px tall incl. descender). Matching
//     = Hamming distance between binarised cell and template.
//
//  2. Anti-aliased engine ("aa" font): proportional font of header/bottom-bar boxes
//     (e.g. "5 ns/", "10 v/"). Glyphs are segmented by blank columns, then each glyph
//     is described by a 10x14 intensity raster of its bounding box plus geometry
//     (width/height/top relative to the font size `em` and the baseline).
//     Matching = weighted squared distance. Scale-independent, so templates from the
//     16 px header font also work for the 18 px bottom-bar font.
//
// Images are passed as {width, height, data: Uint8ClampedArray RGBA} ("img").
App.ocr = (() => {
  const FEAT_W = 10, FEAT_H = 14;

  // ---------- pixel helpers ----------
  const lum = (img, x, y) => {
    const i = (y * img.width + x) * 4, d = img.data;
    return Math.max(d[i], d[i + 1], d[i + 2]);
  };

  // =====================================================================
  // Bitmap engine
  // =====================================================================
  const BM = { pitch: 6, w: 5, h: 11, thr: 110 };

  /** Binarise one character cell -> string of '0'/'1' (row-major, w*h). */
  function bitmapCell(img, x, y) {
    let s = '';
    for (let r = 0; r < BM.h; r++)
      for (let c = 0; c < BM.w; c++) {
        const xx = x + c, yy = y + r;
        s += (xx >= 0 && yy >= 0 && xx < img.width && yy < img.height && lum(img, xx, yy) > BM.thr) ? '1' : '0';
      }
    return s;
  }

  function hamming(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }

  /** Classify one cell. Returns {ch, dist}. Empty cells -> ' '. */
  function matchBitmapCell(cell) {
    let on = 0;
    for (let i = 0; i < cell.length; i++) if (cell[i] === '1') on++;
    if (on === 0) return { ch: ' ', dist: 0 };
    let best = { ch: '?', dist: Infinity };
    const tmpl = (App.GLYPHS && App.GLYPHS.small) || {};
    for (const ch in tmpl) {
      for (const t of tmpl[ch]) {
        const d = hamming(cell, t);
        if (d < best.dist) best = { ch, dist: d };
      }
    }
    if (best.dist > 6) best.ch = '?';
    return best;
  }

  /**
   * Read a fixed-pitch line of up to `n` cells starting at (x, y) = top-left of the first cell.
   * Searches small offsets (dx, dy) and keeps the best-scoring alignment.
   * Returns {text, score, x, y} where score = mean distance of non-blank cells (lower is better).
   */
  function readBitmapLine(img, x, y, n, search = { dx: [0], dy: [0] }) {
    let best = null;
    for (const dy of search.dy) for (const dx of search.dx) {
      let text = '', sum = 0, cnt = 0, unknown = 0;
      for (let k = 0; k < n; k++) {
        const m = matchBitmapCell(bitmapCell(img, x + dx + k * BM.pitch, y + dy));
        text += m.ch;
        if (m.ch !== ' ') { sum += m.dist; cnt++; if (m.ch === '?') unknown++; }
      }
      // Score: prefer many recognised characters with low distance.
      const score = cnt ? (sum + unknown * 10) / cnt - cnt * 0.01 : Infinity;
      if (!best || score < best.score) best = { text, score, x: x + dx, y: y + dy };
    }
    // Keep only the first "word group": labels are separated from neighbours by 2+ spaces.
    best.text = best.text.replace(/\s{2,}.*$/, '').trim();
    return best;
  }

  // =====================================================================
  // Anti-aliased engine
  // =====================================================================

  /**
   * Segment glyphs inside rect {x0,y0,x1,y1} (exclusive end). Text = pixels brighter than
   * the box background by `delta`. Returns glyph boxes [{x0,x1,y0,y1}] (inclusive coords).
   */
  function segmentAA(img, rect, delta = 70) {
    const { x0, y0, x1, y1 } = rect;
    // Background = median luminance of the rect border-ish (use whole rect median: text is sparse).
    const vals = [];
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) vals.push(lum(img, x, y));
    const bg = App.util.median(vals);
    const on = (x, y) => lum(img, x, y) - bg > delta;
    const cols = [];
    for (let x = x0; x < x1; x++) {
      let any = false;
      for (let y = y0; y < y1 && !any; y++) if (on(x, y)) any = true;
      cols.push(any);
    }
    const boxes = [];
    for (let i = 0; i < cols.length;) {
      if (!cols[i]) { i++; continue; }
      let j = i; while (j < cols.length && cols[j]) j++;
      let top = Infinity, bot = -1;
      for (let x = x0 + i; x < x0 + j; x++)
        for (let y = y0; y < y1; y++) if (on(x, y)) { if (y < top) top = y; if (y > bot) bot = y; }
      boxes.push({ x0: x0 + i, x1: x0 + j - 1, y0: top, y1: bot });
      i = j;
    }
    return { boxes, bg };
  }

  /** Feature vector of a glyph box: 10x14 normalised intensity raster (area-sampled). */
  function glyphFeatures(img, box, bg) {
    const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
    let maxL = bg + 1;
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) maxL = Math.max(maxL, lum(img, x, y));
    const f = new Array(FEAT_W * FEAT_H).fill(0);
    // Supersample each feature cell 3x3
    for (let fy = 0; fy < FEAT_H; fy++) for (let fx = 0; fx < FEAT_W; fx++) {
      let acc = 0;
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
        const x = box.x0 + Math.min(w - 1, Math.floor(((fx + (sx + 0.5) / 3) / FEAT_W) * w));
        const y = box.y0 + Math.min(h - 1, Math.floor(((fy + (sy + 0.5) / 3) / FEAT_H) * h));
        acc += App.util.clamp((lum(img, x, y) - bg) / (maxL - bg), 0, 1);
      }
      f[fy * FEAT_W + fx] = acc / 9;
    }
    return f;
  }

  /** Geometry of a glyph relative to font size `em` and `baseline` (y of bottom of digits). */
  const glyphGeom = (box, em, baseline) => ({
    w: (box.x1 - box.x0 + 1) / em,
    h: (box.y1 - box.y0 + 1) / em,
    top: (baseline - box.y0) / em,
  });

  function aaDistance(feat, geom, t) {
    let d = 0;
    for (let i = 0; i < feat.length; i++) { const e = feat[i] - t.f[i]; d += e * e; }
    d /= feat.length;
    const g = (geom.w - t.w) ** 2 + (geom.h - t.h) ** 2 + (geom.top - t.top) ** 2;
    return d + 3 * g;
  }

  /**
   * Read an anti-aliased text line in rect. `em` = digit height in px for this font size.
   * Baseline is estimated as the most common glyph bottom row.
   * Returns {text, glyphs:[{ch, dist, box}], conf} ; unknown glyphs become '?'.
   */
  function readAALine(img, rect, em) {
    const { boxes, bg } = segmentAA(img, rect);
    if (!boxes.length) return { text: '', glyphs: [], conf: 0 };
    const baseline = estimateBaseline(boxes);
    const tmpl = (App.GLYPHS && App.GLYPHS.aa) || [];
    const glyphs = boxes.map(box => {
      const feat = glyphFeatures(img, box, bg), geom = glyphGeom(box, em, baseline);
      let best = { ch: '?', dist: Infinity };
      for (const t of tmpl) {
        const d = aaDistance(feat, geom, t);
        if (d < best.dist) best = { ch: t.ch, dist: d };
      }
      if (best.dist > 0.06) best.ch = '?';
      return { ...best, box, geom };
    });
    // Geometric fallbacks for characters without harvested templates.
    glyphs.forEach((g, i) => {
      if (g.ch !== '?') return;
      const { w, h, top } = g.geom, next = glyphs[i + 1];
      if (h < 0.22 && w > 0.25 && top > 0.3 && top < 0.75) g.ch = '-';
      else if (h < 0.25 && w < 0.25 && top < 0.3) g.ch = '.';
      else if (top - h < -0.12 && next && /[sVvA]/.test(next.ch)) g.ch = 'µ'; // has descender, sits before unit
    });
    let text = '';
    glyphs.forEach((g, i) => {
      if (i > 0 && g.box.x0 - glyphs[i - 1].box.x1 - 1 > em * 0.33) text += ' ';
      text += g.ch;
    });
    const known = glyphs.filter(g => g.ch !== '?').length;
    return { text, glyphs, conf: known / glyphs.length, baseline };
  }

  function estimateBaseline(boxes) {
    const counts = {};
    boxes.forEach(b => { counts[b.y1] = (counts[b.y1] || 0) + 1; });
    let best = boxes[0].y1, bc = 0;
    for (const k in counts) if (counts[k] > bc || (counts[k] === bc && +k < best)) { bc = counts[k]; best = +k; }
    return best;
  }

  // ---------- harvesting support (used by tools/harvest.html) ----------
  function harvestAA(img, rect, em, expected) {
    const { boxes, bg } = segmentAA(img, rect);
    const chars = expected.replace(/\s+/g, '');
    if (boxes.length !== chars.length) return { ok: false, reason: `segments ${boxes.length} != chars ${chars.length} for "${expected}"` };
    const baseline = estimateBaseline(boxes);
    return {
      ok: true,
      templates: boxes.map((box, i) => ({ ch: chars[i], f: glyphFeatures(img, box, bg), ...glyphGeom(box, em, baseline) })),
    };
  }

  function harvestBitmap(img, x, y, expected) {
    const cells = [];
    for (let k = 0; k < expected.length; k++) {
      if (expected[k] === ' ') continue;
      cells.push({ ch: expected[k], bits: bitmapCell(img, x + k * BM.pitch, y) });
    }
    return cells;
  }

  return { readBitmapLine, readAALine, segmentAA, harvestAA, harvestBitmap, bitmapCell, BM };
})();
