// Small canvas plotting helpers for the DPT page: HiDPI canvas sizing, linear scales, nice
// ticks with one SI prefix per axis, axes + grid, colour scales and marker shapes.
App.dpt.plot = (() => {
  const PAD = { l: 64, r: 14, t: 12, b: 34 };
  // Reference categorical palette (dark-surface steps, fixed order) and a sequential blue ramp
  // running dim -> bright so larger values stand out on the dark background.
  const CATEGORICAL = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  const SEQ = ['#1c5cab', '#256abf', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
  const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'down', 'circle', 'square', 'triangle'];
  const INK = { fg: '#e5e7eb', fg2: '#9aa3af', grid: '#232a33', axis: '#3a4350', bg: '#08090b', hl: '#4ade80' };
  const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];

  /** Size the canvas backing store to its CSS box × devicePixelRatio; returns { ctx, w, h } in CSS px. */
  function fit(canvas) {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  /** Plot area inside a w × h canvas. */
  const area = (w, h, pad = PAD) => ({ x: pad.l, y: pad.t, w: Math.max(10, w - pad.l - pad.r), h: Math.max(10, h - pad.t - pad.b) });

  /** Linear map [d0, d1] -> [r0, r1] with .inv. */
  function scale(d0, d1, r0, r1) {
    const k = (r1 - r0) / ((d1 - d0) || 1);
    const f = x => r0 + (x - d0) * k;
    f.inv = y => d0 + (y - r0) / k;
    f.d0 = d0; f.d1 = d1;
    return f;
  }

  /** Logarithmic map [d0, d1] (> 0) -> [r0, r1]; ticks() and axes() label it per decade. */
  function logScale(d0, d1, r0, r1) {
    const l = scale(Math.log10(d0), Math.log10(d1), r0, r1);
    const f = x => l(Math.log10(x));
    f.inv = y => Math.pow(10, l.inv(y));
    f.d0 = d0; f.d1 = d1; f.log = true;
    return f;
  }
  /** 1-2-5 values per decade inside [lo, hi] (fewer when the range spans many decades). */
  function logTicks(lo, hi, target) {
    const e0 = Math.floor(Math.log10(lo)), e1 = Math.ceil(Math.log10(hi)), dec = e1 - e0;
    const ms = dec * 3 <= target * 1.5 ? [1, 2, 5] : [1];
    const out = [];
    for (let e = e0; e <= e1; e++) for (const m of ms) { const v = m * Math.pow(10, e); if (v >= lo * 0.9999 && v <= hi * 1.0001) out.push(v); }
    return out;
  }

  /** Nice tick step (1-2-5) for about `target` ticks over [lo, hi]. */
  function niceStep(lo, hi, target = 6) {
    const raw = (hi - lo) / target || 1, e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
  }
  function ticks(lo, hi, target) {
    const st = niceStep(lo, hi, target), out = [];
    for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v);
    return { step: st, ticks: out };
  }

  /** Tick formatter for one axis: shared SI prefix, decimals from the step. */
  function axisFormat(lo, hi, step, unit) {
    const abs = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    let [mult, pre] = PREFIX[PREFIX.length - 1];
    for (const p of PREFIX) { if (abs >= p[0] * 0.9995) { [mult, pre] = p; break; } }
    const dec = Math.max(0, Math.ceil(-Math.log10(step / mult) - 1e-9));
    return { fmt: v => (v / mult).toFixed(dec), unit: pre + unit };
  }

  /** Padded [lo, hi] of finite values; falls back to [0, 1]. */
  function extent(values, padFrac = 0.06) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) return [0, 1];
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; return [lo - d, hi + d]; }
    const d = (hi - lo) * padFrac;
    return [lo - d, hi + d];
  }

  /**
   * Grid, axes and labels. sx/sy from scale(); o = { xUnit, yUnit, xTitle, yTitle, xTickFmt }.
   * Returns nothing; draw data afterwards (clipped with clip(ctx, A)).
   */
  function axes(ctx, A, sx, sy, o = {}) {
    const nx = Math.max(3, Math.round(A.w / 90)), ty = ticks(sy.d0, sy.d1, Math.max(3, Math.round(A.h / 45)));
    const tx = sx.log ? { ticks: logTicks(sx.d0, sx.d1, nx) } : ticks(sx.d0, sx.d1, nx);
    // log axis: every tick carries its own prefix (they span decades), the title has the bare unit
    const fx = sx.log ? { fmt: v => App.util.formatSI(v, '', 3), unit: o.xUnit || '' } : axisFormat(sx.d0, sx.d1, tx.step, o.xUnit || '');
    const fy = axisFormat(sy.d0, sy.d1, ty.step, o.yUnit || '');
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = INK.grid; ctx.beginPath();
    for (const v of tx.ticks) { const X = Math.round(sx(v)) + 0.5; ctx.moveTo(X, A.y); ctx.lineTo(X, A.y + A.h); }
    for (const v of ty.ticks) { const Y = Math.round(sy(v)) + 0.5; ctx.moveTo(A.x, Y); ctx.lineTo(A.x + A.w, Y); }
    ctx.stroke();
    ctx.strokeStyle = INK.axis; ctx.strokeRect(A.x + 0.5, A.y + 0.5, A.w - 1, A.h - 1);
    ctx.fillStyle = INK.fg2; ctx.font = '11px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of tx.ticks) ctx.fillText(fx.fmt(v), sx(v), A.y + A.h + 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of ty.ticks) ctx.fillText(fy.fmt(v), A.x - 6, sy(v));
    ctx.fillStyle = INK.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${o.xTitle || ''}${fx.unit ? ` (${fx.unit})` : ''}`, A.x + A.w / 2, A.y + A.h + 32);
    ctx.translate(14, A.y + A.h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle';
    ctx.fillText(`${o.yTitle || ''}${fy.unit ? ` (${fy.unit})` : ''}`, 0, 0);
    ctx.restore();
  }

  function clip(ctx, A) { ctx.save(); ctx.beginPath(); ctx.rect(A.x, A.y, A.w, A.h); ctx.clip(); }

  /** Marker of a given shape centred at (x, y), radius r. */
  function marker(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'square') ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    else if (shape === 'triangle') { ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r, y + r * 0.75); ctx.lineTo(x - r, y + r * 0.75); ctx.closePath(); }
    else if (shape === 'down') { ctx.moveTo(x, y + r * 1.1); ctx.lineTo(x + r, y - r * 0.75); ctx.lineTo(x - r, y - r * 0.75); ctx.closePath(); }
    else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); }
    else ctx.arc(x, y, r, 0, Math.PI * 2);
  }

  /** Colour on the sequential ramp for f in 0..1. */
  function seq(f) {
    if (!isFinite(f)) return INK.fg2;
    const x = Math.max(0, Math.min(1, f)) * (SEQ.length - 1), i = Math.min(SEQ.length - 2, Math.floor(x)), a = x - i;
    const c = k => [1, 3, 5].map(j => parseInt(SEQ[k].slice(j, j + 2), 16));
    const p = c(i), q = c(i + 1);
    return `rgb(${p.map((v, j) => Math.round(v + (q[j] - v) * a)).join(',')})`;
  }

  return { PAD, CATEGORICAL, MARKERS, INK, SEQ, fit, area, scale, logScale, ticks, axisFormat, extent, axes, clip, marker, seq };
})();
