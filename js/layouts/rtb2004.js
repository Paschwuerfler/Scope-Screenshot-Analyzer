// Layout: Rohde & Schwarz RTB2004 (RTB2000 family) screenshot, 1280 x 824 px.
//
// Screen geometry (identical in every screenshot, side menu may cover the right part):
//   graticule x 39..1239 (12 div x 100 px), y 100..704 (10 div x 60.4 px)
//   header boxes (anti-aliased font, digit height 16 px): timebase, position, ...
//   bottom bar: one box per channel C1..C4 starting with a 43 px coloured label square;
//               box is 200 px wide when the channel is on, 100 px when off.
//   left edge (x 0..37): channel marker arrows at the channel's 0 V level.
//   axis labels (bitmap font): x labels right of each vertical grid line along the bottom,
//               y labels above each horizontal grid line along the left edge; they show
//               the scale of the *selected* channel.
//
// Calibration sources are fused; each value gets status 'ok' (sources agree / reliable)
// or 'warn' (single unreliable source or conflict) so the UI can flag it.
(() => {
  const W = 1280, H = 824;
  const GRID = { left: 39, right: 1239, top: 100, bottom: 704, hdiv: 12, vdiv: 10 };
  const PX_X = 100, PX_Y = 60.4, CX = 639;
  const HEADER_EM = 16, BOTTOM_EM = 18;

  // Header text boxes (anti-aliased font). Names match tools/samples.js `header`.
  const REGIONS = {
    timebase: { x0: 930, y0: 27, x1: 1065, y1: 60 },
    position: { x0: 930, y0: 64, x1: 1065, y1: 98 },
    trigLevel: { x0: 655, y0: 64, x1: 790, y1: 98 },
    sampleRate: { x0: 795, y0: 64, x1: 928, y1: 98 },
    trigMode: { x0: 795, y0: 27, x1: 928, y1: 60 },
    acqState: { x0: 1068, y0: 27, x1: 1200, y1: 60 },
    acqMode: { x0: 1068, y0: 64, x1: 1200, y1: 98 },
  };
  // Axis label cell origins (top-left of first character cell) for the bitmap font.
  const xLabelOrigin = k => ({ x: GRID.left + PX_X * k + 3, y: GRID.bottom - 15 });       // k = 1..11
  const yLabelOrigin = k => ({ x: 42, y: Math.floor(GRID.top + PX_Y * k) - 15 });         // k = 1..10
  const LABEL_SEARCH = { dx: [-1, 0, 1], dy: [-2, -1, 0, 1, 2] };

  const px = (img, x, y) => { const i = (y * img.width + x) * 4, d = img.data; return [d[i], d[i + 1], d[i + 2]]; };
  const isGray = ([r, g, b]) => Math.abs(r - g) < 10 && Math.abs(g - b) < 10;

  // ------------------------------------------------------------------ match
  function match(img) {
    if (img.width !== W || img.height !== H) return 0;
    // Vertical grid lines at x = 139, 239, ... 1139 are drawn as gray pixels.
    let lines = 0;
    for (let k = 1; k <= 11; k++) {
      const x = GRID.left + PX_X * k;
      let hits = 0, n = 0;
      for (let y = 110; y < 690; y += 4) {
        n++;
        const p = px(img, x, y);
        if (isGray(p) && p[0] > 50 && p[0] < 170) hits++;
      }
      if (hits / n > 0.25) lines++;
    }
    // Header bar background is a dark blue-gray.
    let header = 0, hn = 0;
    for (let x = 260; x < 600; x += 10) { hn++; const [r, g, b] = px(img, x, 70); if (r < 70 && b < 90 && b >= r) header++; }
    return 0.75 * (lines / 11) + 0.25 * (header / hn);
  }

  // ------------------------------------------------------------------ helpers
  /** Robust line fit through points [{p, v}] (p = pixel, v = value). Returns {slope, icpt, inliers} or null. */
  function robustFit(pts, relTol) {
    if (pts.length < 2) return null;
    let best = null;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      if (pts[j].p === pts[i].p) continue;
      const s = (pts[j].v - pts[i].v) / (pts[j].p - pts[i].p);
      if (s === 0) continue;
      const tol = Math.abs(s) * relTol;
      const inl = pts.filter(q => Math.abs(q.v - (pts[i].v + s * (q.p - pts[i].p))) <= tol);
      if (!best || inl.length > best.length) best = inl;
    }
    if (!best || best.length < 3) return null;
    // least squares on inliers
    const n = best.length, mp = best.reduce((a, q) => a + q.p, 0) / n, mv = best.reduce((a, q) => a + q.v, 0) / n;
    let num = 0, den = 0;
    best.forEach(q => { num += (q.p - mp) * (q.v - mv); den += (q.p - mp) ** 2; });
    const slope = num / den;
    return { slope, icpt: mv - slope * mp, inliers: n, total: pts.length };
  }

  const sig = (v, d = 4) => Number(v.toPrecision(d));
  const agree = (a, b, rel) => Math.abs(a - b) <= Math.abs(b) * rel + 1e-18;

  // ------------------------------------------------------------------ bottom bar
  function readChannelBoxes(img, raw) {
    // Find the four label squares on row y=792: uniform runs 36..48 px wide.
    const y = 792, runs = [];
    let s = 0;
    for (let x = 1; x <= 1200; x++) {
      const a = px(img, x, y), b = px(img, s, y);
      const diff = x === 1200 ? 999 : Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      if (diff > 40) { if (x - s >= 36 && x - s <= 48) runs.push({ x0: s, x1: x - 1, color: px(img, s + 5, y) }); s = x; }
    }
    const squares = runs.filter(r => {
      const [rr, gg, bb] = r.color, mx = Math.max(rr, gg, bb);
      return mx > 90; // label squares are bright (gray 126 or coloured), box backgrounds are dark
    }).slice(0, 4);
    const out = {};
    App.calib.CHANNELS.forEach((c, i) => {
      const sq = squares[i];
      if (!sq) { out[c.id] = { on: false, found: false }; return; }
      const on = !isGray(sq.color);
      const selected = on && Math.max(...sq.color) > 200;
      let vdiv = null, text = '';
      const rect = { x0: sq.x1 + 3, y0: 786, x1: sq.x0 + 165, y1: 823 };
      if (on) {
        const r = App.ocr.readAALine(img, rect, BOTTOM_EM);
        text = r.text;
        // Proportional font spacing is unreliable ("1 0v/"), so parse with spaces removed.
        const p = App.util.parseSI(r.text.replace(/\s+/g, ''), null);
        if (p && (p.unit === '' || /^[va]$/i.test(p.unit))) vdiv = { value: p.value, unit: p.unit.toUpperCase() || 'V' };
      }
      out[c.id] = { on, selected, vdiv, text, found: true, rect };
      raw[`bottom_${c.id}`] = text;
    });
    return out;
  }

  // ------------------------------------------------------------------ markers
  function readMarkers(img) {
    const groups = [];
    let cur = null;
    for (let y = 92; y <= 714; y++) {
      let cnt = 0, hs = [];
      for (let x = 2; x <= 34; x++) {
        const [r, g, b] = px(img, x, y), hsv = App.util.rgb2hsv(r, g, b);
        if (hsv.s > 0.15 && hsv.v > 0.45 && !isGray([r, g, b])) { cnt++; hs.push([r, g, b]); }
      }
      if (cnt >= 14) {
        if (!cur || y !== cur.y1 + 1) { cur = { y0: y, y1: y, cols: [] }; groups.push(cur); }
        cur.y1 = y; cur.cols.push(...hs);
      }
    }
    return groups.filter(g => g.y1 - g.y0 >= 6).map(g => {
      const n = g.cols.length, avg = [0, 1, 2].map(i => g.cols.reduce((a, c) => a + c[i], 0) / n);
      const hsv = App.util.rgb2hsv(...avg);
      let ch = null, bestD = Infinity;
      App.calib.CHANNELS.forEach(c => {
        const mid = (c.hue[0] + c.hue[1]) / 2;
        let d = Math.abs(hsv.h - mid); d = Math.min(d, 360 - d);
        if (hsv.h >= c.hue[0] - 5 && hsv.h <= c.hue[1] + 5 && d < bestD) { bestD = d; ch = c.id; }
      });
      return { y: (g.y0 + g.y1) / 2, y0: g.y0, y1: g.y1, ch, color: avg,
        clipped: g.y0 <= GRID.top + 2 || g.y1 >= GRID.bottom - 2 };
    });
  }

  // ------------------------------------------------------------------ axis labels
  function readXLabels(img, raw) {
    const pts = [];
    raw.xLabels = [];
    for (let k = 1; k <= 11; k++) {
      const o = xLabelOrigin(k);
      const r = App.ocr.readBitmapLine(img, o.x, o.y, 12, LABEL_SEARCH);
      raw.xLabels.push(r.text);
      const p = App.util.parseSI(r.text, 's');
      if (p) pts.push({ p: GRID.left + PX_X * k, v: p.value });
    }
    return robustFit(pts, 0.03);
  }

  function readYLabels(img, raw) {
    const pts = [];
    raw.yLabels = [];
    let unit = 'V';
    for (let k = 1; k <= 10; k++) {
      const o = yLabelOrigin(k);
      const r = App.ocr.readBitmapLine(img, o.x, o.y, 10, LABEL_SEARCH);
      raw.yLabels.push(r.text);
      const p = App.util.parseSI(r.text, null);
      if (p && /^[VA]$/.test(p.unit)) { pts.push({ p: GRID.top + PX_Y * k, v: p.value }); unit = p.unit; }
    }
    const fit = robustFit(pts, 0.03);
    if (fit) fit.unit = unit;
    return fit;
  }

  // ------------------------------------------------------------------ persistence
  function detectPersistence(img) {
    // Colour-graded persistence draws rare hits in saturated blue (hue ~200-230).
    let blue = 0;
    for (let y = GRID.top + 2; y < GRID.bottom - 2; y += 2)
      for (let x = GRID.left + 2; x < GRID.right - 2; x += 2) {
        const [r, g, b] = px(img, x, y), hsv = App.util.rgb2hsv(r, g, b);
        if (hsv.h >= 195 && hsv.h <= 232 && hsv.s > 0.55 && hsv.v > 0.3) blue++;
      }
    return blue > 400;
  }

  // ------------------------------------------------------------------ analyze
  function analyze(img) {
    const raw = {}, notes = [];
    const calib = App.calib.emptyCalib(W, H);
    calib.grid = { ...GRID };
    const status = { time: {}, channels: {} };

    // ---- time axis
    const tbTxt = App.ocr.readAALine(img, REGIONS.timebase, HEADER_EM).text;
    const posTxt = App.ocr.readAALine(img, REGIONS.position, HEADER_EM).text;
    raw.timebase = tbTxt; raw.position = posTxt;
    const hTb = App.util.parseSI(tbTxt.replace(/\s+/g, ''), 's'), hPos = App.util.parseSI(posTxt.replace(/\s+/g, ''), 's');
    const xfit = readXLabels(img, raw);
    const lTb = xfit ? sig(xfit.slope * PX_X) : null;
    const lPos = xfit ? sig(xfit.icpt + xfit.slope * CX) : null;

    if (hTb && lTb !== null) {
      if (agree(hTb.value, lTb, 0.01)) { calib.time.tdiv = hTb.value; status.time.tdiv = 'ok'; }
      else { calib.time.tdiv = lTb; status.time.tdiv = 'warn'; notes.push(`Timebase: header reads "${tbTxt}", axis labels give ${App.util.formatSI(lTb, 's')}/div — using axis labels.`); }
    } else if (lTb !== null) {
      calib.time.tdiv = lTb; status.time.tdiv = xfit.inliers >= 6 ? 'ok' : 'warn';
    } else if (hTb) {
      calib.time.tdiv = hTb.value; status.time.tdiv = 'warn'; notes.push('Timebase only from header text (axis labels unreadable).');
    } else { status.time.tdiv = 'warn'; notes.push('Timebase not recognised — please enter it.'); }

    const tol = 0.05 * calib.time.tdiv;
    if (hPos && lPos !== null) {
      if (Math.abs(hPos.value - lPos) <= tol) { calib.time.tCenter = hPos.value; status.time.tCenter = 'ok'; }
      else { calib.time.tCenter = lPos; status.time.tCenter = 'warn'; notes.push(`Position: header reads "${posTxt}", axis labels give ${App.util.formatSI(lPos, 's')} — using axis labels.`); }
    } else if (lPos !== null) {
      calib.time.tCenter = lPos; status.time.tCenter = xfit.inliers >= 6 ? 'ok' : 'warn';
    } else if (hPos) {
      calib.time.tCenter = hPos.value; status.time.tCenter = 'warn';
    } else { status.time.tCenter = 'warn'; notes.push('Horizontal position not recognised — please enter it.'); }

    // ---- channels
    const boxes = readChannelBoxes(img, raw);
    const markers = readMarkers(img);
    const yfit = readYLabels(img, raw);
    raw.markers = markers.map(m => `${m.ch || '?'}@${m.y}`).join(' ');
    const selected = Object.keys(boxes).find(id => boxes[id].selected) || Object.keys(boxes).find(id => boxes[id].on) || null;
    const lVdiv = yfit ? sig(-yfit.slope * PX_Y) : null;
    const lZero = yfit ? -yfit.icpt / yfit.slope : null; // y where value = 0
    const usedMarkers = new Set();

    for (const c of App.calib.CHANNELS) {
      const b = boxes[c.id], ch = calib.channels[c.id];
      ch.on = !!b.on;
      if (!ch.on) continue;
      const st = status.channels[c.id] = {};
      const isSel = c.id === selected;

      // V/div
      if (b.vdiv && isSel && lVdiv !== null) {
        if (agree(b.vdiv.value, lVdiv, 0.01)) { ch.vdiv = b.vdiv.value; st.vdiv = 'ok'; }
        else { ch.vdiv = lVdiv; st.vdiv = 'warn'; notes.push(`${c.id}: bottom bar reads "${b.text}", axis labels give ${App.util.formatSI(lVdiv, yfit.unit)}/div — using axis labels.`); }
        ch.unit = b.vdiv.unit;
      } else if (b.vdiv) { ch.vdiv = b.vdiv.value; ch.unit = b.vdiv.unit; st.vdiv = 'ok'; }
      else if (isSel && lVdiv !== null) { ch.vdiv = lVdiv; ch.unit = yfit.unit; st.vdiv = 'ok'; }
      else {
        ch.vdiv = lVdiv || 1; st.vdiv = 'warn';
        notes.push(`${c.id}: V/div not recognised ("${b.text}") — please check.`);
      }

      // 0 V level
      const m = markers.find(mk => mk.ch === c.id && !usedMarkers.has(mk));
      if (m) {
        usedMarkers.add(m);
        ch.zeroY = m.y; st.zeroY = m.clipped ? 'warn' : 'ok';
        if (m.clipped) notes.push(`${c.id}: 0 V marker at screen edge — offset may be off-screen.`);
        if (isSel && lZero !== null && Math.abs(lZero - m.y) > 3) {
          ch.zeroY = lZero; st.zeroY = 'warn';
          notes.push(`${c.id}: marker at y=${m.y} disagrees with axis labels (y=${lZero.toFixed(1)}) — using axis labels.`);
        } else if (isSel && lZero !== null) { ch.zeroY = lZero; }
      } else if (isSel && lZero !== null) {
        ch.zeroY = lZero; st.zeroY = 'ok';
      } else if (markers.length) {
        // Marker probably hidden under another channel's marker (same offset).
        const other = markers.find(mk => !mk.ch || mk.ch !== c.id) || markers[0];
        ch.zeroY = other.y; st.zeroY = 'warn';
        notes.push(`${c.id}: own 0 V marker not visible — assuming it is hidden under the marker at y=${other.y}.`);
      } else { ch.zeroY = GRID.top + (GRID.bottom - GRID.top) / 2; st.zeroY = 'warn'; notes.push(`${c.id}: 0 V level not found — please set it.`); }
    }

    calib.persistence = detectPersistence(img);
    calib.persistChannel = calib.persistence ? selected : null;
    if (calib.persistence) notes.push(`Persistence (colour-graded) display detected — trace values use the most frequent (hottest) pixels.`);
    calib.selected = selected;
    return { calib, status, notes, raw };
  }

  App.layouts.register({
    id: 'rtb2004', name: 'R&S RTB2004 (1280×824)',
    match, analyze,
    // exposed for tools/harvest.html
    REGIONS, HEADER_EM, BOTTOM_EM, GRID, xLabelOrigin, yLabelOrigin, LABEL_SEARCH, readChannelBoxes,
  });
})();
