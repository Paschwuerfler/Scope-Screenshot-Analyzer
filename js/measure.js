// Measurements. Everything here works in physical units (s, V) so the same code can
// later serve imported time-series data (see docs/EXTENDING.md "Add an auto-measurement").
App.measure = (() => {
  const C = App.calib;

  /** Convert an extracted screenshot trace into a series {t: Float64Array, v: Float64Array} (NaN-free). */
  function traceToSeries(doc, chId) {
    if (doc.kind === 'series') {
      const s = doc.series, col = s.cols.find(c => c.id === chId);
      return col ? { t: Float64Array.from({ length: s.n }, (_, i) => s.t0 + i * s.dt), v: Float64Array.from(col.v) } : null;
    }
    const tr = doc.traces && doc.traces[chId];
    if (!tr) return null;
    const t = [], v = [];
    for (let x = 0; x < tr.mid.length; x++) {
      if (isNaN(tr.mid[x])) continue;
      t.push(C.tAt(doc.calib, x)); v.push(C.vAt(doc.calib, chId, tr.mid[x]));
    }
    return { t: Float64Array.from(t), v: Float64Array.from(v) };
  }

  /**
   * Value of channel at image column x: {v, vMin, vMax} or null (vMin/vMax = displayed band).
   * alt = true reads the second branch of a split persistence trace.
   */
  function valueAtX(doc, chId, x, alt = false) {
    if (doc.kind === 'series') {   // exact sample data, x = fractional sample index
      const v = alt ? null : App.series.valueAt(doc.series, chId, x);
      return v === null ? null : { v, vMin: v, vMax: v };
    }
    const tr = doc.traces && doc.traces[chId];
    const p = App.traces.yAt(tr && (alt ? tr.alt : tr), x);
    if (!p) return null;
    const c = doc.calib;
    return { v: C.vAt(c, chId, p.mid), vMin: C.vAt(c, chId, p.hi), vMax: C.vAt(c, chId, p.lo) };
  }

  /**
   * Channels the cursors probe (shown in readout, on the canvas, in Copy). doc.cursors.probe is
   * the user's choice (array of ids); default = the scope's selected channel, else the first one on.
   */
  function probedChannels(doc) {
    const c = doc.calib, on = C.CHANNELS.map(ch => ch.id).filter(id => c.channels[id] && c.channels[id].on);
    const p = doc.cursors && doc.cursors.probe;
    if (Array.isArray(p)) return on.filter(id => p.includes(id));
    return [on.includes(c.selected) ? c.selected : on[0]].filter(Boolean);
  }

  /**
   * Readout for the two vertical cursors.
   * Returns { t1, t2, dt, freq, channels: [{id, alt, unit, v1, v2, dv, slope, a, b}] }.
   * A channel whose persistence trace splits gets a second entry with alt = true.
   */
  function cursorReadout(doc) {
    const c = doc.calib, cur = doc.cursors;
    const t1 = C.tAt(c, cur.x1), t2 = C.tAt(c, cur.x2), dt = t2 - t1;
    const channels = [], probed = probedChannels(doc);
    for (const ch of C.CHANNELS) {
      const cc = c.channels[ch.id];
      if (!cc || !cc.on || !probed.includes(ch.id)) continue;
      const entry = alt => {
        const a = valueAtX(doc, ch.id, cur.x1, alt), b = valueAtX(doc, ch.id, cur.x2, alt);
        const v1 = a ? a.v : null, v2 = b ? b.v : null;
        const dv = v1 !== null && v2 !== null ? v2 - v1 : null;
        return { id: ch.id, alt, unit: cc.unit || 'V', v1, v2, dv, slope: dv !== null && dt !== 0 ? dv / dt : null, a, b };
      };
      channels.push(entry(false));
      const tr = doc.traces && doc.traces[ch.id];
      if (tr && tr.alt) { const e = entry(true); if (e.a || e.b) channels.push(e); }
    }
    const ro = { t1, t2, dt, freq: dt !== 0 ? 1 / Math.abs(dt) : null, channels };
    ro.periods = periodReadout(doc, ro);
    return ro;
  }

  // ---- multi-period mode (ringing frequency over several cycles)
  // doc.cursors.periods = { p0, x1 } | null: p0 = reference period in image px (the cursor
  // spacing when the mode was switched on, refined by setPeriodCount), x1 = cursor 1 anchor.

  /** Number of whole periods between the cursors (>= 1), or 0 when the mode is off. */
  function periodCount(doc) {
    const p = doc.cursors.periods;
    if (!p || !(p.p0 > 0)) return 0;
    return Math.max(1, Math.round(Math.abs(doc.cursors.x2 - doc.cursors.x1) / p.p0));
  }

  /** Image-px positions of the N-1 evenly spaced marks between the cursors. */
  function periodMarks(doc) {
    const n = periodCount(doc), { x1, x2 } = doc.cursors, out = [];
    for (let k = 1; k < n; k++) out.push(x1 + (x2 - x1) * k / n);
    return out;
  }

  /**
   * Readout in multi-period mode, or null: { n, period, freq, channels: [{id, alt, unit, amp, ampMin,
   * ampMax, pp, cycles}] }. Amplitude = (max − min) / 2 of the trace centre line within each of
   * the N cycles, averaged; ampMin/ampMax = smallest/largest cycle (shows decay).
   */
  function periodReadout(doc, ro) {
    const n = periodCount(doc);
    if (!n) return null;
    const { x1, x2 } = doc.cursors, xa = Math.min(x1, x2), w = Math.abs(x2 - x1) / n;
    const channels = ro.channels.map(c => {
      const cycles = [];
      for (let k = 0; k < n; k++) {
        let lo = Infinity, hi = -Infinity;
        const s = Math.ceil(xa + k * w), e = Math.floor(xa + (k + 1) * w);
        for (let x = s; x <= e; x++) {
          const p = valueAtX(doc, c.id, x, c.alt);
          if (p) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
        }
        if (hi >= lo) cycles.push(hi - lo);
      }
      if (!cycles.length) return { id: c.id, alt: c.alt, unit: c.unit, amp: null, ampMin: null, ampMax: null, pp: null, cycles };
      const pp = cycles.reduce((a, b) => a + b, 0) / cycles.length;
      return { id: c.id, alt: c.alt, unit: c.unit, amp: pp / 2, ampMin: Math.min(...cycles) / 2, ampMax: Math.max(...cycles) / 2, pp, cycles };
    });
    const adt = Math.abs(ro.dt);
    return { n, period: adt / n, freq: adt ? n / adt : null, channels };
  }

  return { traceToSeries, valueAtX, probedChannels, cursorReadout, periodCount, periodMarks };
})();
