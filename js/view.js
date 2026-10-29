// Canvas view: draws the active screenshot plus overlays (calibration, extracted traces,
// cursors) and handles mouse interaction.
//
// Coordinates: image px (ix, iy) <-> screen CSS px: sx = ox + ix * kx, sy = oy + iy * ky.
// Screenshots: kx = ky = view.scale. Series (CSV) docs: ix = sample index, the graticule always
// fills the canvas height and doc.view = { xa, xb } is the visible sample window (time-only zoom).
// Per-doc zoom/pan lives in doc.view (runtime only).
//
// Mouse:  drag cursor line or its tag = move cursor | drag elsewhere = pan | wheel = zoom
//         double-click = move nearest cursor here | pick modes (zero level, grid) via setMode()
//         merged views: Ctrl+drag a curve = shift its recording in time (App.docs.remerge)
App.view = (() => {
  const CURSOR_COLORS = { 1: '#22d3ee', 2: '#f472b6' };
  const PERIOD_COLOR = '#e5e7eb';   // multi-period marks
  const HIT_PX = 8;
  let canvas, ctx, dpr = 1;
  let mode = null;            // null | {type:'pick-zero', ch} | {type:'pick-grid'}
  let drag = null;            // {type:'cursor', n} | {type:'pan', sx, sy, ox, oy} | {type:'grid', ix0, iy0, ix1, iy1} | {type:'shift', part, sx, s0, spp}
  let hover = null;           // {ix, iy}
  let hoverHandle = null;     // series: channel id whose 0-level handle is under the pointer (tooltip)

  const doc = () => App.docs.active();
  const prefs = () => App.ui.prefs;
  // Screenshot mode (prefs.bigText): canvas text, the boxes around it and the margins scale by F().
  const BIG_TEXT = 1.8;
  const F = () => (prefs().bigText ? BIG_TEXT : 1);
  const font = (px, bold) => `${bold ? 'bold ' : ''}${px * F()}px system-ui, sans-serif`;

  // ---------------------------------------------------------------- transforms
  function viewOf(d) {
    if (d.kind === 'series') return seriesView(d);
    if (!d.view) d.view = fitView(d);
    return d.view;
  }
  // series: plot margins (room for 0-level markers left, cursor tags above, Δt bracket below)
  // (scaled in screenshot mode; recomputed in seriesView, which every series draw / hit test goes through)
  const SPAD0 = { l: 40, r: 14, t: 34, b: 40 }, HANDLE_W0 = 36;   // handle: grip dots + channel name + arrow tip
  let SPAD = SPAD0, HANDLE_W = HANDLE_W0;
  function seriesView(d) {
    const f = F();
    HANDLE_W = HANDLE_W0 * f; SPAD = { l: HANDLE_W + 4, r: SPAD0.r, t: SPAD0.t * f, b: SPAD0.b * f };
    const w = clampWindow(d, d.view || { xa: 0, xb: d.width - 1 });
    d.view = w;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const kx = Math.max(1, W - SPAD.l - SPAD.r) / (w.xb - w.xa), ky = Math.max(1, H - SPAD.t - SPAD.b) / d.height;
    return { kx, ky, ox: SPAD.l - w.xa * kx, oy: SPAD.t, xa: w.xa, xb: w.xb, scale: kx, series: true };
  }
  /** Keep the window inside the data and at least a few samples wide. */
  function clampWindow(d, w) {
    const n = d.width - 1, minW = Math.min(n, 8);
    let xa = w.xa, xb = w.xb;
    if (!(xb - xa >= minW)) { const c = (xa + xb) / 2; xa = c - minW / 2; xb = c + minW / 2; }
    if (xb - xa > n) { xa = 0; xb = n; }
    if (xa < 0) { xb -= xa; xa = 0; }
    if (xb > n) { xa -= xb - n; xb = n; }
    return { xa: Math.max(0, xa), xb };
  }
  function fitView(d) {
    const W = canvas.clientWidth, H = canvas.clientHeight, pad = 12;
    const scale = Math.min((W - 2 * pad) / d.width, (H - 2 * pad) / d.height);
    return { scale, ox: (W - d.width * scale) / 2, oy: (H - d.height * scale) / 2, fitted: true };
  }
  /** Fit the graticule, leaving room above for cursor tags and below for the Δt bracket. */
  function fitGridView(d) {
    const g = d.calib.grid, W = canvas.clientWidth, H = canvas.clientHeight;
    const padX = 16, padTop = 34 * F(), padBottom = 34 * F();
    const gw = g.right - g.left, gh = g.bottom - g.top;
    const scale = Math.min((W - 2 * padX) / gw, (H - padTop - padBottom) / gh);
    return { scale, ox: (W - gw * scale) / 2 - g.left * scale, oy: padTop + (H - padTop - padBottom - gh * scale) / 2 - g.top * scale, fitted: false };
  }
  const toScreen = (v, ix, iy) => [v.ox + ix * (v.kx || v.scale), v.oy + iy * (v.ky || v.scale)];
  const toImage = (v, sx, sy) => [(sx - v.ox) / (v.kx || v.scale), (sy - v.oy) / (v.ky || v.scale)];

  // ---------------------------------------------------------------- setup
  function init(el) {
    canvas = el; ctx = canvas.getContext('2d');
    new ResizeObserver(() => { resize(); }).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', () => { hover = hoverHandle = null; App.events.emit('hover', null); render(); });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
    resize();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    // keep fitted views fitted
    App.docs.list().forEach(d => { if (d.view && d.view.fitted) d.view = null; });
    render();
  }

  // ---------------------------------------------------------------- rendering
  let raf = 0, lastScale = 0, lastWin = {};
  function render() { if (!raf) raf = requestAnimationFrame(draw); }

  function draw() {
    raf = 0;
    const d = doc();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!d) return;
    const v = viewOf(d);
    const zoomLevel = v.series ? (d.width - 1) / (v.xb - v.xa) : v.scale;
    if (zoomLevel !== lastScale) { lastScale = zoomLevel; App.events.emit('zoom', zoomLevel); }
    if (v.series && (v.xa !== lastWin.xa || v.xb !== lastWin.xb)) { lastWin = { xa: v.xa, xb: v.xb }; App.events.emit('window', d); }
    if (v.series) drawSeries(d, v);
    else {
      ctx.imageSmoothingEnabled = v.scale < 2;
      ctx.drawImage(d.bitmap, v.ox, v.oy, d.width * v.scale, d.height * v.scale);
      if (prefs().showOverlay) drawOverlay(d, v);
    }
    drawCursors(d, v);
    if (App.overview) App.overview.render();
    if (drag && drag.type === 'grid') drawGridDrag(v);
    if (mode && hover) drawPickHint(d, v);
    if (v.series && !drag && hoverHandle) drawHandleTip(d, v);
  }

  /** Screen positions of the series 0-level handles: [{id, y, out}] (out = -1/+1 if clamped above/below). */
  function seriesHandles(d, v) {
    const g = d.calib.grid, y0 = v.oy + g.top * v.ky, y1 = v.oy + g.bottom * v.ky, out = [];
    for (const col of d.series.cols) {
      const cc = d.calib.channels[col.id];
      if (!cc || !cc.on) continue;
      const raw = v.oy + cc.zeroY * v.ky, y = App.util.clamp(raw, y0 + 6 * F(), y1 - 6 * F());
      out.push({ id: col.id, y, out: raw < y ? -1 : raw > y ? 1 : 0 });
    }
    return out;
  }
  function hitHandle(d, v, sx, sy) {
    if (!v.series || sx > SPAD.l + 1 || sx < SPAD.l - HANDLE_W - 2) return null;
    const hs = seriesHandles(d, v).reverse();   // topmost drawn first
    const h = hs.find(h => Math.abs(h.y - sy) <= 8 * F());
    return h ? h.id : null;
  }

  // Series plot, scope style: time grid at multiples of a 1-2-5 time/div, 8 value divs, each
  // channel with its own scale/div and 0-level handle, legend top left.
  function drawSeries(d, v) {
    const c = d.calib, s = d.series, g = c.grid, fmt = App.util.formatSI;
    const [x0, y0] = [SPAD.l, v.oy], x1 = canvas.clientWidth - SPAD.r, y1 = toScreen(v, 0, g.bottom)[1];
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // time grid pinned to absolute time (moves with zoom/pan), spacing jumps along 1-2-5
    const tA = App.calib.tAt(c, v.xa), tB = App.calib.tAt(c, v.xb), tdiv = App.series.gridDiv(tB - tA);
    const lines = [];
    for (let k = Math.ceil(tA / tdiv); k * tdiv <= tB; k++) lines.push({ k, sx: v.ox + App.calib.xAt(c, k * tdiv) * v.kx });
    ctx.strokeStyle = '#3a4049'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
    ctx.beginPath();
    for (const ln of lines) { const sx = Math.round(ln.sx) + 0.5; ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); }
    for (let k = 1; k < g.vdiv; k++) { const sy = Math.round(y0 + (y1 - y0) * k / g.vdiv) + 0.5; ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#59616d'; ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);

    // traces, clipped to the graticule
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.lineWidth = 1.25; ctx.lineJoin = 'round';
    for (const col of s.cols) {
      const cc = c.channels[col.id];
      if (!cc || !cc.on) continue;
      ctx.strokeStyle = App.calib.channelById(col.id).color;
      App.series.strokeSeries(ctx, s, col, v.xa, v.xb, i => v.ox + i * v.kx, val => v.oy + App.calib.yAt(c, col.id, val) * v.ky, x1 - x0);
    }
    ctx.restore();

    const f = F();
    // 0-level handles left of the grid (drag = offset, wheel = scale): grip dots, name, arrow tip
    ctx.font = font(10, true); ctx.textBaseline = 'middle';
    const hl = x0 - HANDLE_W, hh = 7 * f, tip = x0 - 1 - 7 * f;
    for (const h of seriesHandles(d, v)) {
      ctx.fillStyle = App.calib.channelById(h.id).color;
      ctx.beginPath(); ctx.moveTo(hl, h.y - hh); ctx.lineTo(tip, h.y - hh); ctx.lineTo(x0 - 1, h.y); ctx.lineTo(tip, h.y + hh); ctx.lineTo(hl, h.y + hh); ctx.closePath(); ctx.fill();
      const active = (drag && drag.type === 'offset' && drag.ch === h.id) || (!drag && hoverHandle === h.id);
      if (active) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = '#0b0d10';
      for (let r = -1; r <= 1; r++) for (const gx of [hl + 3 * f, hl + 6 * f]) ctx.fillRect(gx, h.y + (r * 3 - 0.75) * f, 1.5 * f, 1.5 * f);
      ctx.fillText(h.out ? h.id.slice(1) + (h.out < 0 ? '↑' : '↓') : h.id, hl + 10 * f, h.y + 0.5);
    }
    // time labels under the grid lines (every 1st/2nd/5th line, whatever fits), legend top left
    ctx.font = font(11); ctx.textBaseline = 'top'; ctx.fillStyle = '#9aa3af';
    const lbl = k => fmt(k * tdiv, 's', 4), lw = Math.max(...[tA, tB].map(t => ctx.measureText(lbl(Math.round(t / tdiv))).width)) + 14;
    const pitch = lines.length > 1 ? lines[1].sx - lines[0].sx : Infinity, every = [1, 2, 5, 10].find(m => m * pitch >= lw) || 10;
    for (const ln of lines) {
      if (ln.k % every) continue;
      const txt = lbl(ln.k), w = ctx.measureText(txt).width;
      if (ln.sx - w / 2 < x0 - 20 || ln.sx + w / 2 > x1 + SPAD.r) continue;
      ctx.fillText(txt, ln.sx - w / 2, y1 + 26 * f);
    }
    ctx.textBaseline = 'middle';
    let lx = x0 + 6, ly = y0 + 4;   // wraps to a new row at the right edge
    const item = (txt, col) => {
      const w = ctx.measureText(txt).width + 10 * f;
      if (lx > x0 + 6 && lx + w > x1 - 4) { lx = x0 + 6; ly += 19 * f; }
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; roundRect(lx - 3, ly, w, 17 * f, 3); ctx.fill(); ctx.fillStyle = col; ctx.fillText(txt, lx + 2 * f, ly + 9 * f); lx += w + 4;
    };
    item(d.parts ? `${fmt(tdiv, 's', 3)}/div` : `${fmt(tdiv, 's', 3)}/div · ${fmt(1 / s.dt, 'Sa/s', 4)}`, '#e5e7eb');
    for (const col of s.cols) {
      const cc = c.channels[col.id];
      if (cc && cc.on) item(`${App.calib.chLabel(d, col.id)} ${fmt(cc.vdiv, cc.unit, 3)}/div`, App.calib.channelById(col.id).color);
    }
    // y axis labels in the colour of one channel (App.series.axisChannel), at the inner division lines (below the legend)
    const ax = App.series.axisChannel(d);
    if (ax) {
      const ac = c.channels[ax];
      ctx.font = font(11); ctx.textBaseline = 'middle';
      for (let k = 1; k < g.vdiv; k++) {
        const iy = g.top + (g.bottom - g.top) * k / g.vdiv, sy = toScreen(v, 0, iy)[1];
        if (sy - 8 * f < ly + 17 * f + 2) continue;   // under the legend
        const txt = fmt(snap0(App.calib.vAt(c, ax, iy), ac.vdiv), ac.unit, 3), w = ctx.measureText(txt).width + 8 * f;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; roundRect(x0 + 3, sy - 8 * f, w, 16 * f, 3); ctx.fill();
        ctx.fillStyle = App.calib.channelById(ax).color; ctx.fillText(txt, x0 + 3 + 4 * f, sy + 0.5);
      }
    }
    ctx.restore();
  }

  /** Tooltip right of a hovered series handle: channel + scale, and what wheel / drag do.
   *  Drawn last in draw() so cursors and labels never cover it. */
  function drawHandleTip(d, v) {
    const h = seriesHandles(d, v).find(h => h.id === hoverHandle);
    if (!h) return;
    const cc = d.calib.channels[h.id], x0 = SPAD.l, y0 = v.oy, y1 = toScreen(v, 0, d.calib.grid.bottom)[1];
    ctx.save();
    const f = F();
    const lines = [
      [`${App.calib.chLabel(d, h.id)} · ${App.util.formatSI(cc.vdiv, cc.unit, 3)}/div`, font(12, true), App.calib.channelById(h.id).color],
      ['Scroll to change vertical scale', font(12), '#f3f4f6'],
      ['Drag to move (Shift: no snapping)', font(12), '#b8c0cc'],
      ...(d.parts ? [['Ctrl+drag the curve to shift it in time', font(12), '#b8c0cc']] : []),
    ];
    const w = Math.max(...lines.map(([t, fnt]) => { ctx.font = fnt; return ctx.measureText(t).width; })) + 16 * f, lh = 17 * f, H = lines.length * lh + 10 * f;
    const x = x0 + 8, y = App.util.clamp(h.y - H / 2, y0 + 2, y1 - H - 2);
    ctx.fillStyle = 'rgba(13,16,20,0.95)'; ctx.strokeStyle = '#3e4858'; ctx.lineWidth = 1;
    roundRect(x + 0.5, y + 0.5, w, H, 5); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle';
    lines.forEach(([t, fnt, col], i) => { ctx.font = fnt; ctx.fillStyle = col; ctx.fillText(t, x + 8 * f, y + 5 * f + lh * i + lh / 2); });
    ctx.restore();
  }

  // Detection overlay (sanity check): dims the screenshot and draws what the calibration and
  // trace extraction believe — every division line labelled with the time/value the calibration
  // assigns to it (compare with the scope's own grid and labels), 0 levels, extracted curves and
  // their detected band (min/max per column).
  const OVERLAY_GRID = '#22d3ee';
  function drawOverlay(d, v) {
    const c = d.calib, g = c.grid;
    const [x0, y0] = toScreen(v, g.left, g.top), [x1, y1] = toScreen(v, g.right, g.bottom);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(v.ox, v.oy, d.width * v.scale, d.height * v.scale);

    // graticule: all division lines
    ctx.strokeStyle = OVERLAY_GRID; ctx.lineWidth = 1; ctx.globalAlpha = 0.55; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let k = 0; k <= g.hdiv; k++) { const sx = Math.round(x0 + (x1 - x0) * k / g.hdiv) + 0.5; ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); }
    for (let k = 0; k <= g.vdiv; k++) { const sy = Math.round(y0 + (y1 - y0) * k / g.vdiv) + 0.5; ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); }
    ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);

    // time labels at each vertical line (bottom, inside the grid)
    ctx.font = font(11); ctx.textBaseline = 'bottom';
    for (let k = 0; k <= g.hdiv; k++) {
      const ix = g.left + (g.right - g.left) * k / g.hdiv, sx = x0 + (x1 - x0) * k / g.hdiv;
      label(App.util.formatSI(snap0(App.calib.tAt(c, ix), c.time.tdiv), 's', 4), sx + 3, y1 - 3, OVERLAY_GRID);
    }
    // value labels at each horizontal line, one column per distinct channel scale
    const groups = [];
    for (const ch of App.calib.CHANNELS) {
      const cc = c.channels[ch.id];
      if (!cc || !cc.on) continue;
      const grp = groups.find(gp => gp.vdiv === cc.vdiv && Math.abs(gp.zeroY - cc.zeroY) < 0.5 && gp.unit === cc.unit);
      if (grp) grp.ids.push(ch.id); else groups.push({ ids: [ch.id], vdiv: cc.vdiv, zeroY: cc.zeroY, unit: cc.unit, color: ch.color });
    }
    ctx.textBaseline = 'top';
    groups.forEach((gp, gi) => {
      for (let k = 0; k <= g.vdiv; k++) {
        const iy = g.top + (g.bottom - g.top) * k / g.vdiv, sy = y0 + (y1 - y0) * k / g.vdiv;
        const val = snap0(App.calib.vAt(c, gp.ids[0], iy), gp.vdiv);
        label(`${k === 0 ? gp.ids.join('/') + ' ' : ''}${App.util.formatSI(val, gp.unit, 4)}`, x0 + 3 + gi * 92 * F(), sy + 2, gp.color);
      }
    });

    // per channel: 0 level, detected band, extracted curve
    for (const ch of App.calib.CHANNELS) {
      const cc = c.channels[ch.id];
      if (!cc || !cc.on) continue;
      const [, zy] = toScreen(v, 0, cc.zeroY);
      ctx.strokeStyle = ch.color; ctx.lineWidth = 1; ctx.setLineDash([8, 4]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(x0, zy); ctx.lineTo(x1, zy); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = ch.color; ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(x0 - 12, zy - 6); ctx.lineTo(x0 - 1, zy); ctx.lineTo(x0 - 12, zy + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      const tr = d.traces && d.traces[ch.id];
      if (!tr) continue;
      // band: one vertical stroke per image column
      ctx.strokeStyle = ch.color; ctx.globalAlpha = 0.28; ctx.lineWidth = Math.max(1, v.scale);
      ctx.beginPath();
      for (let x = 0; x < tr.lo.length; x++) {
        if (isNaN(tr.lo[x])) continue;
        const [sx, sa] = toScreen(v, x + 0.5, tr.lo[x]), [, sb] = toScreen(v, 0, tr.hi[x] + 1);
        ctx.moveTo(sx, sa); ctx.lineTo(sx, sb);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5; path(tr, v); ctx.stroke();
      ctx.strokeStyle = ch.color; ctx.lineWidth = 1.5; path(tr, v); ctx.stroke();
      if (tr.alt) {   // second branch of a split persistence trace: dashed
        ctx.setLineDash([5, 3]);
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5; path(tr.alt, v); ctx.stroke();
        ctx.strokeStyle = ch.color; ctx.lineWidth = 1.5; path(tr.alt, v); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }
  // Floating-point residue like 1.9e-14 V on the 0 line -> 0.
  const snap0 = (val, perDiv) => (Math.abs(val) < Math.abs(perDiv) * 1e-6 ? 0 : val);
  function label(txt, x, y, color) {
    const w = ctx.measureText(txt).width + 6, h = 14 * F();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 2, ctx.textBaseline === 'bottom' ? y - h + 1 : y - 1, w, h);
    ctx.fillStyle = color; ctx.fillText(txt, x + 1, y);
  }
  function path(tr, v) {
    ctx.beginPath();
    let pen = false;
    for (let x = 0; x < tr.mid.length; x++) {
      const y = tr.mid[x];
      if (isNaN(y)) { pen = false; continue; }
      const [sx, sy] = toScreen(v, x + 0.5, y + 0.5);
      if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      pen = true;
    }
  }

  function drawCursors(d, v) {
    const g = d.calib.grid, cur = d.cursors;
    const [, gy0] = toScreen(v, 0, g.top), [, gy1] = toScreen(v, 0, g.bottom);
    const ro = App.measure.cursorReadout(d);
    ctx.save();
    const f = F();
    ctx.font = font(12); ctx.textBaseline = 'middle';
    // multi-period mode: dashed marks where the intermediate peaks should be, numbered 1..N
    const marks = App.measure.periodMarks(d);
    if (ro.periods) {
      ctx.strokeStyle = PERIOD_COLOR; ctx.lineWidth = 1.25; ctx.setLineDash([6, 4]); ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (const ix of marks) { const sx = Math.round(toScreen(v, ix, 0)[0]) + 0.5; ctx.moveTo(sx, gy0); ctx.lineTo(sx, gy1); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
      marks.forEach((ix, k) => {
        const [sx] = toScreen(v, ix, 0), txt = String(k + 1), w = ctx.measureText(txt).width + 8 * f;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; roundRect(sx - w / 2, gy0 + 3, w, 16 * f, 3); ctx.fill();
        ctx.fillStyle = PERIOD_COLOR; ctx.fillText(txt, sx, gy0 + 3.5 + 8 * f);
      });
      ctx.textAlign = 'left';
    }
    for (const n of [1, 2]) {
      const ix = n === 1 ? cur.x1 : cur.x2;
      const [sx] = toScreen(v, ix, 0);
      const col = CURSOR_COLORS[n], selected = cur.sel === n;
      ctx.strokeStyle = col; ctx.lineWidth = selected ? 2 : 1.25;
      ctx.beginPath(); ctx.moveTo(sx, gy0); ctx.lineTo(sx, gy1); ctx.stroke();
      // tag above the grid
      const t = n === 1 ? ro.t1 : ro.t2;
      // off-screen cursor (zoomed in): tag pinned to the edge with an arrow
      const CW = canvas.clientWidth, off = sx < 0 ? -1 : sx > CW ? 1 : 0;
      const label = `${off < 0 ? '◀ ' : ''}${n}  ${App.util.formatSI(t, 's', 4)}${off > 0 ? ' ▶' : ''}`;
      const tw = ctx.measureText(label).width + 12 * f, th = 18 * f;
      const tx = off ? App.util.clamp(sx - tw / 2, 2, CW - tw - 2) : sx - tw / 2, ty = gy0 - th - 4;
      ctx.fillStyle = col; roundRect(tx, ty, tw, th, 4); ctx.fill();
      if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = '#0b0d10'; ctx.fillText(label, tx + 6 * f, ty + th / 2 + 0.5);
      // trace intersections
      for (const chr of ro.channels) {
        const val = n === 1 ? chr.a : chr.b;
        if (!val) continue;
        const c = App.calib.channelById(chr.id);
        const sy = toScreen(v, 0, App.calib.yAt(d.calib, chr.id, val.v))[1];
        const syLo = toScreen(v, 0, App.calib.yAt(d.calib, chr.id, val.vMax))[1], syHi = toScreen(v, 0, App.calib.yAt(d.calib, chr.id, val.vMin))[1];
        ctx.strokeStyle = c.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(sx, syLo); ctx.lineTo(sx, syHi); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = chr.alt ? '#000' : c.color; ctx.strokeStyle = chr.alt ? c.color : '#000'; ctx.lineWidth = chr.alt ? 2 : 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 4.5 * Math.sqrt(f), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const txt = App.util.formatSI(val.v, chr.unit, 3);
        const w = ctx.measureText(txt).width + 8 * f, lx = n === 1 ? sx - w - 8 * f : sx + 8 * f;
        ctx.fillStyle = 'rgba(0,0,0,0.75)'; roundRect(lx, sy - 9 * f, w, 18 * f, 3); ctx.fill();
        ctx.fillStyle = c.color; ctx.fillText(txt, lx + 4 * f, sy + 0.5);
      }
    }
    // Δt bracket below the grid
    const [sx1] = toScreen(v, cur.x1, 0), [sx2] = toScreen(v, cur.x2, 0);
    const by = gy1 + 14 * f, tk = 5 * f;
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx1, by - tk); ctx.lineTo(sx1, by + tk); ctx.moveTo(sx1, by); ctx.lineTo(sx2, by); ctx.moveTo(sx2, by - tk); ctx.lineTo(sx2, by + tk); ctx.stroke();
    const P = ro.periods;
    const dtTxt = P
      ? `Δt ${App.util.formatSI(ro.dt, 's', 4)} = ${P.n} × ${App.util.formatSI(P.period, 's', 4)}   f ${App.util.formatSI(P.freq, 'Hz', 5)}`
      : `Δt ${App.util.formatSI(ro.dt, 's', 4)}   1/Δt ${App.util.formatSI(ro.freq, 'Hz', 4)}`;
    // centred on the visible part of the bracket, kept on screen
    const CW = canvas.clientWidth, va = Math.max(Math.min(sx1, sx2), 0), vb = Math.min(Math.max(sx1, sx2), CW);
    const w = ctx.measureText(dtTxt).width + 12 * f, mx = App.util.clamp((va + vb) / 2 - w / 2, 2, Math.max(2, CW - w - 2));
    ctx.fillStyle = 'rgba(15,17,21,0.9)'; roundRect(mx, by - 10 * f, w, 20 * f, 4); ctx.fill();
    ctx.fillStyle = '#e5e7eb'; ctx.fillText(dtTxt, mx + 6 * f, by + 0.5);
    ctx.restore();
  }

  function drawGridDrag(v) {
    const [x0, y0] = toScreen(v, Math.min(drag.ix0, drag.ix1), Math.min(drag.iy0, drag.iy1));
    const [x1, y1] = toScreen(v, Math.max(drag.ix0, drag.ix1), Math.max(drag.iy0, drag.iy1));
    ctx.save(); ctx.strokeStyle = '#facc15'; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.restore();
  }

  function drawPickHint(d, v) {
    const [sx, sy] = toScreen(v, hover.ix, hover.iy);
    ctx.save(); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, sy + 0.5); ctx.lineTo(canvas.clientWidth, sy + 0.5);
    if (mode.type === 'pick-grid') { ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, canvas.clientHeight); }
    ctx.stroke(); ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- interaction
  const evPos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  /** Which cursor (1|2) is under screen point, or 0. */
  function hitCursor(d, v, sx, sy) {
    const g = d.calib.grid;
    const [, gy0] = toScreen(v, 0, g.top), [, gy1] = toScreen(v, 0, g.bottom);
    if (sy < gy0 - 22 * F() - 6 || sy > gy1 + 4) return 0;
    let best = 0, bd = HIT_PX;
    for (const n of [1, 2]) {
      const [cx] = toScreen(v, n === 1 ? d.cursors.x1 : d.cursors.x2, 0);
      const dd = Math.abs(cx - sx);
      if (dd <= bd) { bd = dd; best = n; }
    }
    return best;
  }

  /**
   * Merged views: index of the recording (part) whose curve passes near screen point, or -1.
   * Checks the value range over ±3 px so steep edges count too.
   */
  function hitCurve(d, v, sx, sy) {
    if (!v.series || !d.parts) return -1;
    let best = -1, bd = HIT_PX + 4;
    for (const col of d.series.cols) {
      const cc = d.calib.channels[col.id];
      if (!cc || !cc.on) continue;
      let lo = Infinity, hi = -Infinity;
      for (let k = -3; k <= 3; k++) {
        const val = App.series.valueAt(d.series, col.id, (sx + k - v.ox) / v.kx);
        if (val === null) continue;
        const y = v.oy + App.calib.yAt(d.calib, col.id, val) * v.ky;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      const dd = sy < lo ? lo - sy : sy > hi ? sy - hi : 0;
      if (dd < bd) { bd = dd; best = col.part; }
    }
    return best;
  }

  function setCursorX(d, n, ix) {
    ix = App.util.clamp(ix, 0, d.width - 1);
    if (n === 1) d.cursors.x1 = ix; else d.cursors.x2 = ix;
    // moving cursor 1 to another peak starts a new measurement; small fine-tuning keeps the mode
    const p = d.cursors.periods;
    if (n === 1 && p && Math.abs(ix - p.x1) > p.p0 / 2) {
      d.cursors.periods = null;
      App.events.emit('toast', 'Multi-period mode ended (cursor 1 moved to another cycle).');
    }
  }

  function onDown(e) {
    const d = doc(); if (!d) return;
    const v = viewOf(d), [sx, sy] = evPos(e), [ix, iy] = toImage(v, sx, sy);
    canvas.setPointerCapture(e.pointerId);
    if (mode && mode.type === 'pick-zero' && e.button === 0) {
      const ch = d.calib.channels[mode.ch];
      ch.zeroY = iy; d.status.channels[mode.ch] = { ...(d.status.channels[mode.ch] || {}), zeroY: 'manual' };
      setMode(null); App.docs.touch(d, 'calib'); return;
    }
    if (mode && mode.type === 'pick-grid' && e.button === 0) { drag = { type: 'grid', ix0: ix, iy0: iy, ix1: ix, iy1: iy }; return; }
    const hh = e.button === 0 && hitHandle(d, v, sx, sy);
    if (hh) { d.axisCh = hh; drag = { type: 'offset', ch: hh, sy, z0: d.calib.channels[hh].zeroY }; canvas.style.cursor = 'ns-resize'; render(); return; }
    const part = e.button === 0 && (e.ctrlKey || e.metaKey) ? hitCurve(d, v, sx, sy) : -1;
    if (part >= 0) { drag = { type: 'shift', part, sx, s0: d.parts[part].shift || 0, spp: d.series.dt / v.kx }; canvas.style.cursor = 'col-resize'; return; }
    const n = e.button === 0 ? hitCursor(d, v, sx, sy) : 0;
    if (n) { drag = { type: 'cursor', n }; d.cursors.sel = n; canvas.style.cursor = 'ew-resize'; render(); return; }
    drag = { type: 'pan', sx, sy, ox: v.ox, oy: v.oy, xa: v.xa, xb: v.xb, kx: v.kx };
    canvas.style.cursor = 'grabbing';
  }

  function onMove(e) {
    const d = doc(); if (!d) return;
    const v = viewOf(d), [sx, sy] = evPos(e), [ix, iy] = toImage(v, sx, sy);
    hover = { ix, iy };
    App.events.emit('hover', { ix, iy });
    if (drag && drag.type === 'cursor') { setCursorX(d, drag.n, ix); App.events.emit('doc-updated', d, 'cursors'); }
    else if (drag && drag.type === 'offset') {   // snaps to division lines; Shift = free
      const raw = drag.z0 + (sy - drag.sy) / v.ky, ppd = App.calib.pxPerDivY(d.calib);
      d.calib.channels[drag.ch].zeroY = e.shiftKey ? raw : Math.round(raw / ppd) * ppd;
      App.events.emit('doc-updated', d, 'cursors');
    }
    else if (drag && drag.type === 'shift') {   // seconds per screen px stay constant, the time grid is rebuilt
      d.parts[drag.part].shift = drag.s0 + (sx - drag.sx) * drag.spp;
      App.docs.remerge(d);
      App.events.emit('doc-updated', d, 'shift');
    }
    else if (drag && drag.type === 'pan' && v.series) { const dx = (sx - drag.sx) / drag.kx; setWindow(d, drag.xa - dx, drag.xb - dx); }
    else if (drag && drag.type === 'pan') { v.ox = drag.ox + sx - drag.sx; v.oy = drag.oy + sy - drag.sy; v.fitted = false; }
    else if (drag && drag.type === 'grid') { drag.ix1 = ix; drag.iy1 = iy; }
    else {
      hoverHandle = mode ? null : hitHandle(d, v, sx, sy);
      canvas.style.cursor = mode ? 'crosshair' : hoverHandle ? 'ns-resize' : hitCursor(d, v, sx, sy) ? 'ew-resize'
        : (e.ctrlKey || e.metaKey) && hitCurve(d, v, sx, sy) >= 0 ? 'col-resize' : 'grab';
    }
    render();
  }

  function onUp(e) {
    const d = doc();
    if (drag && d) {
      if (drag.type === 'cursor') App.docs.touch(d, 'cursors');
      if (drag.type === 'offset') App.docs.touch(d, 'calib');
      if (drag.type === 'shift') App.docs.remerge(d, true);
      if (drag.type === 'grid') {
        const g = d.calib.grid;
        const l = Math.min(drag.ix0, drag.ix1), r = Math.max(drag.ix0, drag.ix1), t = Math.min(drag.iy0, drag.iy1), b = Math.max(drag.iy0, drag.iy1);
        if (r - l > 10 && b - t > 10) {
          Object.assign(g, { left: Math.round(l), right: Math.round(r), top: Math.round(t), bottom: Math.round(b) });
          d.status.grid = 'manual';
          App.docs.touch(d, 'calib');
        }
        setMode(null);
      }
    }
    drag = null;
    canvas.style.cursor = mode ? 'crosshair' : 'grab';
    render();
  }

  function onWheel(e) {
    const d = doc(); if (!d) return;
    e.preventDefault();
    const v = viewOf(d), [sx, sy] = evPos(e), unit = e.deltaMode === 1 ? 33 : 1;
    // series: sideways scrolling (touchpad / Shift+wheel) pans the time axis
    const side = e.shiftKey ? e.deltaY || e.deltaX : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (v.series && side) { const dx = side * unit / v.kx; setWindow(d, v.xa + dx, v.xb + dx); return; }
    // series: wheel over a channel handle steps its scale (1-2-5), 0 level stays put
    const hh = hitHandle(d, v, sx, sy);
    if (hh && e.deltaY) {
      const ch = d.calib.channels[hh];
      d.axisCh = hh;
      App.series.setScale(d, hh, App.util.step125(ch.vdiv, e.deltaY < 0 ? -1 : 1), ch.zeroY);
      App.docs.touch(d, 'calib');
      return;
    }
    const f = Math.pow(1.0015, -e.deltaY * unit);
    zoomAt(v, sx, sy, f);
  }

  /** The plot as a PNG blob (full device resolution), drawn fresh without the hover tooltip. */
  function toBlob() {
    hoverHandle = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    draw();
    return new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  function zoomAt(v, sx, sy, f) {
    if (v.series) {   // time axis only, anchored at the pointer
      const d = doc(), ix = (sx - v.ox) / v.kx;
      setWindow(d, ix - (ix - v.xa) / f, ix + (v.xb - ix) / f);
      return;
    }
    const ns = App.util.clamp(v.scale * f, 0.05, 40);
    v.ox = sx - (sx - v.ox) * ns / v.scale; v.oy = sy - (sy - v.oy) * ns / v.scale; v.scale = ns; v.fitted = false;
    render();
  }

  function onDblClick(e) {
    const d = doc(); if (!d || mode) return;
    const v = viewOf(d), [sx, sy] = evPos(e), [ix] = toImage(v, sx, sy);
    const n = Math.abs(ix - d.cursors.x1) <= Math.abs(ix - d.cursors.x2) ? 1 : 2;
    setCursorX(d, n, ix); d.cursors.sel = n; App.docs.touch(d, 'cursors');
  }

  // ---------------------------------------------------------------- public API
  function setMode(m) {
    mode = m; canvas.style.cursor = m ? 'crosshair' : 'grab';
    App.events.emit('mode', m); render();
  }
  function fit() { const d = doc(); if (d) { d.view = d.kind === 'series' ? null : fitView(d); render(); } }
  function fitGrid() { const d = doc(); if (d) { d.view = d.kind === 'series' ? null : fitGridView(d); render(); } }
  function zoom(f) { const d = doc(); if (d) zoomAt(viewOf(d), canvas.clientWidth / 2, canvas.clientHeight / 2, f); }
  /** Series docs: visible sample window (fractional sample indices). */
  function getWindow(d) { return d && d.kind === 'series' ? (viewOf(d), d.view) : null; }
  function setWindow(d, xa, xb) {
    if (!d || d.kind !== 'series') return;
    d.view = clampWindow(d, { xa, xb });
    render();
  }
  function nudge(dx) {
    const d = doc(); if (!d) return;
    // series zoomed out: one arrow step = one screen pixel rather than one sample
    if (d.kind === 'series') dx *= Math.max(1, 1 / viewOf(d).kx);
    const n = d.cursors.sel || 1;
    setCursorX(d, n, (n === 1 ? d.cursors.x1 : d.cursors.x2) + dx);
    App.docs.touch(d, 'cursors');
  }
  /** Move cursor n to image/sample x (used by the overview bar). final = drag ended -> save. */
  function moveCursor(n, ix, final) {
    const d = doc(); if (!d) return;
    setCursorX(d, n, ix); d.cursors.sel = n;
    if (final) App.docs.touch(d, 'cursors'); else App.events.emit('doc-updated', d, 'cursors');
  }
  function selectCursor(n) { const d = doc(); if (d) { d.cursors.sel = n; App.docs.touch(d, 'cursors'); } }

  /** Multi-period mode on/off. On: the current cursor spacing becomes the reference period. */
  function togglePeriods() {
    const d = doc(); if (!d) return;
    const c = d.cursors, span = Math.abs(c.x2 - c.x1);
    if (c.periods) c.periods = null;
    else if (span < 3) { App.events.emit('toast', 'Place the cursors on two adjacent peaks first.'); return; }
    else {
      c.periods = { p0: span, x1: c.x1 };
      c.sel = 2;
      App.events.emit('toast', 'Multi-period mode: now drag cursor 2 to a later peak.');
    }
    App.docs.touch(d, 'cursors');
  }
  /** Correct the period count by ±1 (refines the reference period to Δx / N). */
  function stepPeriods(delta) {
    const d = doc(); if (!d || !d.cursors.periods) return;
    const n = Math.max(1, App.measure.periodCount(d) + delta);
    d.cursors.periods.p0 = Math.abs(d.cursors.x2 - d.cursors.x1) / n;
    App.docs.touch(d, 'cursors');
  }

  return { init, render, toBlob, fit, fitGrid, zoom, nudge, selectCursor, setMode, getMode: () => mode, getWindow, setWindow, moveCursor, togglePeriods, stepPeriods, CURSOR_COLORS };
})();
