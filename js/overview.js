// Overview bar above the plot for series (CSV) docs: the whole recording, with the visible
// window highlighted. Drag a cursor line = move that cursor, drag inside the window = pan, drag
// its edges = resize, click/drag outside = jump there, wheel = zoom, double-click = show everything.
// Each channel is scaled to the bar height on its own (shape matters here, not values).
App.overview = (() => {
  const EDGE_PX = 7, CURSOR_PX = 4, PAD = 4;
  let canvas, ctx, dpr = 1, drag = null, raf = 0;
  let cache = null;   // { key, bmp: canvas } pre-rendered traces

  const doc = () => { const d = App.docs.active(); return d && d.kind === 'series' ? d : null; };

  function init(el) {
    canvas = el; ctx = canvas.getContext('2d');
    new ResizeObserver(resize).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', e => {
      const d = doc();
      if (d && drag && (drag.type === 'c1' || drag.type === 'c2')) App.view.moveCursor(+drag.type[1], toI(d, evX(e)), true);
      drag = null;
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', () => { const d = doc(); if (d) App.view.setWindow(d, 0, d.width - 1); });
    resize();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.parentElement.getBoundingClientRect();
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    cache = null; render();
  }

  // sample index <-> overview x
  const W = () => canvas.clientWidth;
  const toX = (d, i) => i / (d.width - 1) * W();
  const toI = (d, x) => x / W() * (d.width - 1);

  function render() { if (!raf) raf = requestAnimationFrame(draw); }

  function tracesBitmap(d) {
    const s = d.series, w = canvas.width, h = canvas.height;
    const key = [d.id, w, h, ...s.cols.map(c => d.calib.channels[c.id].on)].join('|');
    if (cache && cache.key === key) return cache.bmp;
    const bmp = document.createElement('canvas'); bmp.width = w; bmp.height = h;
    const g = bmp.getContext('2d');
    g.scale(dpr, dpr);
    const H = h / dpr;
    g.lineWidth = 1;
    for (const col of s.cols) {
      if (!d.calib.channels[col.id].on) continue;
      const span = col.max - col.min || 1;
      g.strokeStyle = App.calib.channelById(col.id).color; g.globalAlpha = 0.85;
      App.series.strokeColumn(g, col, 0, s.n - 1, i => toX(d, i), v => PAD + (1 - (v - col.min) / span) * (H - 2 * PAD), W());
    }
    cache = { key, bmp };
    return bmp;
  }

  function draw() {
    raf = 0;
    const d = doc();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!d || !canvas.clientWidth) return;
    const H = canvas.clientHeight;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W(), H);
    ctx.drawImage(tracesBitmap(d), 0, 0, W(), H);
    const w = App.view.getWindow(d);
    let a = toX(d, w.xa), b = toX(d, w.xb);
    if (b - a < 3) { const m = (a + b) / 2; a = m - 1.5; b = m + 1.5; }
    // dim outside the window
    ctx.fillStyle = 'rgba(15,17,21,0.7)';
    ctx.fillRect(0, 0, a, H); ctx.fillRect(b, 0, W() - b, H);
    // cursors
    for (const n of [1, 2]) {
      const x = Math.round(toX(d, n === 1 ? d.cursors.x1 : d.cursors.x2)) + 0.5;
      ctx.strokeStyle = App.view.CURSOR_COLORS[n]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    // window frame + edge handles
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.5;
    ctx.strokeRect(a + 0.75, 0.75, b - a - 1.5, H - 1.5);
    ctx.fillStyle = '#38bdf8';
    for (const x of [a, b]) ctx.fillRect(x - 2, H / 2 - 9, 4, 18);
  }

  function hit(d, x) {
    // cursor lines first (they are thin and would otherwise be unreachable inside the frame)
    const c1 = Math.abs(x - toX(d, d.cursors.x1)), c2 = Math.abs(x - toX(d, d.cursors.x2));
    if (Math.min(c1, c2) <= CURSOR_PX) return c1 <= c2 ? 'c1' : 'c2';
    const w = App.view.getWindow(d), a = toX(d, w.xa), b = toX(d, w.xb);
    if (Math.abs(x - a) <= EDGE_PX && Math.abs(x - a) <= Math.abs(x - b)) return 'l';
    if (Math.abs(x - b) <= EDGE_PX) return 'r';
    return x > a && x < b ? 'move' : 'out';
  }
  const evX = e => e.clientX - canvas.getBoundingClientRect().left;

  function onDown(e) {
    const d = doc(); if (!d || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const x = evX(e), w = App.view.getWindow(d), h = hit(d, x);
    if (h === 'c1' || h === 'c2') { drag = { type: h }; App.view.moveCursor(+h[1], toI(d, x), false); return; }
    if (h === 'out') {   // jump: centre the window here, then keep dragging it
      const c = toI(d, x), half = (w.xb - w.xa) / 2;
      App.view.setWindow(d, c - half, c + half);
    }
    const w2 = App.view.getWindow(d);
    drag = { type: h === 'out' ? 'move' : h, i0: toI(d, x), xa: w2.xa, xb: w2.xb };
  }

  function onMove(e) {
    const d = doc(); if (!d) return;
    const x = evX(e);
    if (!drag) { const h = hit(d, x); canvas.style.cursor = h === 'move' ? 'grab' : h === 'out' ? 'pointer' : 'ew-resize'; return; }
    if (drag.type === 'c1' || drag.type === 'c2') { App.view.moveCursor(+drag.type[1], toI(d, x), false); return; }
    const di = toI(d, x) - drag.i0, minW = 8;
    if (drag.type === 'move') App.view.setWindow(d, drag.xa + di, drag.xb + di);
    else if (drag.type === 'l') App.view.setWindow(d, Math.min(drag.xa + di, drag.xb - minW), drag.xb);
    else App.view.setWindow(d, drag.xa, Math.max(drag.xb + di, drag.xa + minW));
  }

  function onWheel(e) {
    const d = doc(); if (!d) return;
    e.preventDefault();
    const w = App.view.getWindow(d), f = Math.pow(1.0015, -e.deltaY * (e.deltaMode === 1 ? 33 : 1));
    // zoom around the window centre if the pointer is inside it, else around the pointer
    const ip = toI(d, evX(e)), c = ip > w.xa && ip < w.xb ? (w.xa + w.xb) / 2 : ip;
    App.view.setWindow(d, c - (c - w.xa) / f, c + (w.xb - c) / f);
  }

  return { init, render };
})();
