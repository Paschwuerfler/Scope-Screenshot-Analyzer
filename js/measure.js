// Measurements. Everything here works in physical units (s, V) so the same code can
// later serve imported time-series data (see docs/EXTENDING.md "Add an auto-measurement").
App.measure = (() => {
  const C = App.calib;

  /** Convert an extracted screenshot trace into a series {t: Float64Array, v: Float64Array} (NaN-free). */
  function traceToSeries(doc, chId) {
    const tr = doc.traces && doc.traces[chId];
    if (!tr) return null;
    const t = [], v = [];
    for (let x = 0; x < tr.mid.length; x++) {
      if (isNaN(tr.mid[x])) continue;
      t.push(C.tAt(doc.calib, x)); v.push(C.vAt(doc.calib, chId, tr.mid[x]));
    }
    return { t: Float64Array.from(t), v: Float64Array.from(v) };
  }

  /** Value of channel at image column x: {v, vLo, vHi} or null. vLo/vHi = vertical extent in that column. */
  function valueAtX(doc, chId, x) {
    const p = App.traces.yAt(doc.traces && doc.traces[chId], x);
    if (!p) return null;
    const c = doc.calib;
    return { v: C.vAt(c, chId, p.mid), vMin: C.vAt(c, chId, p.hi), vMax: C.vAt(c, chId, p.lo) };
  }

  /**
   * Readout for the two vertical cursors.
   * Returns { t1, t2, dt, freq, channels: [{id, unit, v1, v2, dv, slope}] }.
   */
  function cursorReadout(doc) {
    const c = doc.calib, cur = doc.cursors;
    const t1 = C.tAt(c, cur.x1), t2 = C.tAt(c, cur.x2), dt = t2 - t1;
    const channels = [];
    for (const ch of C.CHANNELS) {
      const cc = c.channels[ch.id];
      if (!cc || !cc.on) continue;
      const a = valueAtX(doc, ch.id, cur.x1), b = valueAtX(doc, ch.id, cur.x2);
      const v1 = a ? a.v : null, v2 = b ? b.v : null;
      const dv = v1 !== null && v2 !== null ? v2 - v1 : null;
      channels.push({ id: ch.id, unit: cc.unit || 'V', v1, v2, dv, slope: dv !== null && dt !== 0 ? dv / dt : null, a, b });
    }
    return { t1, t2, dt, freq: dt !== 0 ? 1 / Math.abs(dt) : null, channels };
  }

  return { traceToSeries, valueAtX, cursorReadout };
})();
