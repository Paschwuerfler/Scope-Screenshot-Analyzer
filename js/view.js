// Canvas view: draws the active screenshot plus overlays (calibration, extracted traces,
// cursors) and handles mouse interaction.
//
// Coordinates: image px (ix, iy) <-> screen CSS px: sx = ox + ix * scale, sy = oy + iy * scale.
// Per-doc zoom/pan lives in doc.view (runtime only).
//
// Mouse:  drag cursor line or its tag = move cursor | drag elsewhere = pan | wheel = zoom
//         double-click = move nearest cursor here | pick modes (zero level, grid) via setMode()
App.view = (() => {
  const CURSOR_COLORS = { 1: '#22d3ee', 2: '#f472b6' };
  const HIT_PX = 8;
  let canvas, ctx, dpr = 1;
  let mode = null;            // null | {type:'pick-zero', ch} | {type:'pick-grid'}
  let drag = null;            // {type:'cursor', n} | {type:'pan', sx, sy, ox, oy} | {type:'grid', ix0, iy0, ix1, iy1}
  let hover = null;           // {ix, iy}

  const doc = () => App.docs.active();
  const prefs = () => App.ui.prefs;

  // ---------------------------------------------------------------- transforms
  function viewOf(d) {
    if (!d.view) d.view = fitView(d);
    return d.view;
  }
  function fitView(d) {
    const W = canvas.clientWidth, H = canvas.clientHeight, pad = 12;
    const scale = Math.min((W - 2 * pad) / d.width, (H - 2 * pad) / d.height);
    return { scale, ox: (W - d.width * scale) / 2, oy: (H - d.height * scale) / 2, fitted: true };
  }
  /** Fit the graticule, leaving room above for cursor tags and below for the Δt bracket. */
  function fitGridView(d) {
    const g = d.calib.grid, W = canvas.clientWidth, H = canvas.clientHeight;
    const padX = 16, padTop = 34, padBottom = 34;
    const gw = g.right - g.left, gh = g.bottom - g.top;
    const scale = Math.min((W - 2 * padX) / gw, (H - padTop - padBottom) / gh);
    return { scale, ox: (W - gw * scale) / 2 - g.left * scale, oy: padTop + (H - padTop - padBottom - gh * scale) / 2 - g.top * scale, fitted: false };
  }
  const toScreen = (v, ix, iy) => [v.ox + ix * v.scale, v.oy + iy * v.scale];
  const toImage = (v, sx, sy) => [(sx - v.ox) / v.scale, (sy - v.oy) / v.scale];

  // ---------------------------------------------------------------- setup
  function init(el) {
    canvas = el; ctx = canvas.getContext('2d');
    new ResizeObserver(() => { resize(); }).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', () => { hover = null; App.events.emit('hover', null); render(); });
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
  let raf = 0, lastScale = 0;
  function render() { if (!raf) raf = requestAnimationFrame(draw); }

  function draw() {
    raf = 0;
    const d = doc();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!d) return;
    const v = viewOf(d);
    if (v.scale !== lastScale) { lastScale = v.scale; App.events.emit('zoom', v.scale); }
    ctx.imageSmoothingEnabled = v.scale < 2;
    ctx.drawImage(d.bitmap, v.ox, v.oy, d.width * v.scale, d.height * v.scale);
    if (prefs().showOverlay) drawOverlay(d, v);
    drawCursors(d, v);
    if (drag && drag.type === 'grid') drawGridDrag(v);
    if (mode && hover) drawPickHint(d, v);
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
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
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
        label(`${k === 0 ? gp.ids.join('/') + ' ' : ''}${App.util.formatSI(val, gp.unit, 4)}`, x0 + 3 + gi * 92, sy + 2, gp.color);
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
    }
    ctx.restore();
  }
  // Floating-point residue like 1.9e-14 V on the 0 line -> 0.
  const snap0 = (val, perDiv) => (Math.abs(val) < Math.abs(perDiv) * 1e-6 ? 0 : val);
  function label(txt, x, y, color) {
    const w = ctx.measureText(txt).width + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 2, ctx.textBaseline === 'bottom' ? y - 13 : y - 1, w, 14);
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
    ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for (const n of [1, 2]) {
      const ix = n === 1 ? cur.x1 : cur.x2;
      const [sx] = toScreen(v, ix, 0);
      const col = CURSOR_COLORS[n], selected = cur.sel === n;
      ctx.strokeStyle = col; ctx.lineWidth = selected ? 2 : 1.25;
      ctx.beginPath(); ctx.moveTo(sx, gy0); ctx.lineTo(sx, gy1); ctx.stroke();
      // tag above the grid
      const t = n === 1 ? ro.t1 : ro.t2;
      const label = `${n}  ${App.util.formatSI(t, 's', 4)}`;
      const tw = ctx.measureText(label).width + 12, th = 18;
      const tx = sx - tw / 2, ty = gy0 - th - 4;
      ctx.fillStyle = col; roundRect(tx, ty, tw, th, 4); ctx.fill();
      if (selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.fillStyle = '#0b0d10'; ctx.fillText(label, tx + 6, ty + th / 2 + 0.5);
      // trace intersections
      for (const chr of ro.channels) {
        const val = n === 1 ? chr.a : chr.b;
        if (!val) continue;
        const c = App.calib.channelById(chr.id);
        const sy = toScreen(v, 0, App.calib.yAt(d.calib, chr.id, val.v))[1];
        const syLo = toScreen(v, 0, App.calib.yAt(d.calib, chr.id, val.vMax))[1], syHi = toScreen(v, 0, App.calib.yAt(d.calib, chr.id, val.vMin))[1];
        ctx.strokeStyle = c.color; ctx.lineWidth = 3; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(sx, syLo); ctx.lineTo(sx, syHi); ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = c.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (prefs().showValueLabels) {
          const txt = App.util.formatSI(val.v, chr.unit, 3);
          const w = ctx.measureText(txt).width + 8, lx = n === 1 ? sx - w - 8 : sx + 8;
          ctx.fillStyle = 'rgba(0,0,0,0.75)'; roundRect(lx, sy - 9, w, 18, 3); ctx.fill();
          ctx.fillStyle = c.color; ctx.fillText(txt, lx + 4, sy + 0.5);
        }
      }
    }
    // Δt bracket below the grid
    const [sx1] = toScreen(v, cur.x1, 0), [sx2] = toScreen(v, cur.x2, 0);
    const by = gy1 + 14;
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx1, by - 5); ctx.lineTo(sx1, by + 5); ctx.moveTo(sx1, by); ctx.lineTo(sx2, by); ctx.moveTo(sx2, by - 5); ctx.lineTo(sx2, by + 5); ctx.stroke();
    const dtTxt = `Δt ${App.util.formatSI(ro.dt, 's', 4)}   1/Δt ${App.util.formatSI(ro.freq, 'Hz', 4)}`;
    const w = ctx.measureText(dtTxt).width + 12, mx = (sx1 + sx2) / 2 - w / 2;
    ctx.fillStyle = 'rgba(15,17,21,0.9)'; roundRect(mx, by - 10, w, 20, 4); ctx.fill();
    ctx.fillStyle = '#e5e7eb'; ctx.fillText(dtTxt, mx + 6, by + 0.5);
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
    if (sy < gy0 - 28 || sy > gy1 + 4) return 0;
    let best = 0, bd = HIT_PX;
    for (const n of [1, 2]) {
      const [cx] = toScreen(v, n === 1 ? d.cursors.x1 : d.cursors.x2, 0);
      const dd = Math.abs(cx - sx);
      if (dd <= bd) { bd = dd; best = n; }
    }
    return best;
  }

  function setCursorX(d, n, ix) {
    ix = App.util.clamp(ix, 0, d.width - 1);
    if (n === 1) d.cursors.x1 = ix; else d.cursors.x2 = ix;
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
    const n = e.button === 0 ? hitCursor(d, v, sx, sy) : 0;
    if (n) { drag = { type: 'cursor', n }; d.cursors.sel = n; canvas.style.cursor = 'ew-resize'; render(); return; }
    drag = { type: 'pan', sx, sy, ox: v.ox, oy: v.oy };
    canvas.style.cursor = 'grabbing';
  }

  function onMove(e) {
    const d = doc(); if (!d) return;
    const v = viewOf(d), [sx, sy] = evPos(e), [ix, iy] = toImage(v, sx, sy);
    hover = { ix, iy };
    App.events.emit('hover', { ix, iy });
    if (drag && drag.type === 'cursor') { setCursorX(d, drag.n, ix); App.events.emit('doc-updated', d, 'cursors'); }
    else if (drag && drag.type === 'pan') { v.ox = drag.ox + sx - drag.sx; v.oy = drag.oy + sy - drag.sy; v.fitted = false; }
    else if (drag && drag.type === 'grid') { drag.ix1 = ix; drag.iy1 = iy; }
    else canvas.style.cursor = mode ? 'crosshair' : hitCursor(d, v, sx, sy) ? 'ew-resize' : 'grab';
    render();
  }

  function onUp(e) {
    const d = doc();
    if (drag && d) {
      if (drag.type === 'cursor') App.docs.touch(d, 'cursors');
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
    const v = viewOf(d), [sx, sy] = evPos(e);
    const f = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    zoomAt(v, sx, sy, f);
  }

  function zoomAt(v, sx, sy, f) {
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
  function fit() { const d = doc(); if (d) { d.view = fitView(d); render(); } }
  function fitGrid() { const d = doc(); if (d) { d.view = fitGridView(d); render(); } }
  function zoom(f) { const d = doc(); if (d) zoomAt(viewOf(d), canvas.clientWidth / 2, canvas.clientHeight / 2, f); }
  function nudge(dx) {
    const d = doc(); if (!d) return;
    const n = d.cursors.sel || 1;
    setCursorX(d, n, (n === 1 ? d.cursors.x1 : d.cursors.x2) + dx);
    App.docs.touch(d, 'cursors');
  }
  function selectCursor(n) { const d = doc(); if (d) { d.cursors.sel = n; App.docs.touch(d, 'cursors'); } }

  return { init, render, fit, fitGrid, zoom, nudge, selectCursor, setMode, getMode: () => mode, CURSOR_COLORS };
})();
