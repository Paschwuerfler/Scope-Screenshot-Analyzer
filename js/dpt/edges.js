// Switching-edge metrics for double-pulse tests (DPT). Pure maths on uniformly sampled
// waveforms { t0, dt, v } in SI units, no DOM. A shot can hold several edges (turn-off and
// turn-on of a double pulse); every edge is measured between its own settled levels, because
// the off-state level shifts with current (third-quadrant drop) and the on-state level may
// settle slowly. Metric definitions are documented in README.md ("DPT sweep").
App.dpt = App.dpt || {};
App.dpt.edges = (() => {
  const DEFAULTS = {
    ringWindow: 50e-9,   // search the first oscillation within this time after t50
    dvdtWindow: 2e-9,    // least-squares slope over this span for peak dv/dt
    curWindow: 20e-9,    // edge current = mean of the current channel over this time before t50
  };

  /** Noise sigma from sample-to-sample differences (robust), at least half a quantisation step. */
  function noiseSigma(v) {
    const d = [];
    let lsb = Infinity;
    for (let i = 1; i < v.length; i++) {
      const a = Math.abs(v[i] - v[i - 1]);
      d.push(a);
      if (a > 0 && a < lsb) lsb = a;
    }
    d.sort((a, b) => a - b);
    const mad = d[d.length >> 1] || 0;
    return Math.max(1.4826 * mad / Math.SQRT2, isFinite(lsb) ? lsb / 2 : 0);
  }

  /** 3-sample moving average (endpoints copied). Takes the edge off quantisation noise for peak search. */
  function smooth3(v) {
    const s = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) s[i] = i && i < v.length - 1 ? (v[i - 1] + v[i] + v[i + 1]) / 3 : v[i];
    return s;
  }

  function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]; }

  function medianOf(v, a, b) {
    a = Math.max(0, Math.floor(a)); b = Math.min(v.length - 1, Math.ceil(b));
    if (b < a) return NaN;
    return App.util.median(Array.from(v.subarray ? v.subarray(a, b + 1) : v.slice(a, b + 1)));
  }

  function mean(v, a = 0, b = v.length - 1) {
    a = Math.max(0, Math.floor(a)); b = Math.min(v.length - 1, Math.ceil(b));
    if (b < a) return NaN;
    let s = 0;
    for (let i = a; i <= b; i++) s += v[i];
    return s / (b - a + 1);
  }

  /**
   * Coarse edges: hysteresis at 30 / 70 % of the overall swing (2nd..98th percentile) on the
   * smoothed signal. Returns { edges: [{dir: +1|-1, i}], lo, hi } or null when the swing is
   * not clearly above noise (no switching in this shot).
   */
  function findEdges(s, sigma) {
    const sorted = Float32Array.from(s).sort();
    const lo = percentile(sorted, 0.02), hi = percentile(sorted, 0.98), swing = hi - lo;
    if (!(swing > 20 * sigma)) return null;
    const thLo = lo + 0.3 * swing, thHi = lo + 0.7 * swing, minSeg = 10;
    let state = s[0] > (lo + hi) / 2 ? 1 : -1;
    const edges = [];
    for (let i = 1; i < s.length; i++) {
      if (state < 0 && s[i] > thHi) { state = 1; edges.push({ dir: 1, i }); }
      else if (state > 0 && s[i] < thLo) { state = -1; edges.push({ dir: -1, i }); }
    }
    // glitches: two transitions closer than minSeg samples cancel out
    for (let k = edges.length - 1; k > 0; k--) {
      if (edges[k].i - edges[k - 1].i < minSeg) { edges.splice(k - 1, 2); k--; }
    }
    return { edges, lo, hi };
  }

  /** Time (fractional sample index) where v crosses level L, scanning from i in direction step. */
  function crossing(v, L, i, step, dir, limA, limB) {
    // dir = +1: rising through L. Scanning backwards we look for the last sample below L,
    // forwards for the first sample at/above L (mirrored for falling edges).
    const below = x => dir > 0 ? x < L : x > L;
    if (step < 0) {
      for (let k = i; k > limA; k--) if (below(v[k - 1]) && !below(v[k])) return k - 1 + (L - v[k - 1]) / (v[k] - v[k - 1]);
    } else {
      for (let k = Math.max(i, limA + 1); k <= limB; k++) if (below(v[k - 1]) && !below(v[k])) return k - 1 + (L - v[k - 1]) / (v[k] - v[k - 1]);
    }
    return null;
  }

  /**
   * Analyse one shot. sw = switch-node waveform, cur = current waveform (or null).
   * Returns { edges: [...], sigma, iMean, warn: [..reasons] }; each edge:
   * { kind: 'rise'|'fall', n (1-based per kind), t50, base, top, swing, t10, t90, t20, t80,
   *   slew1090, slew2080, trise, dvdtMax, overshoot, overshootPct, ringPP, tRing, iEdge, warn: [] }
   * Slew rates and dv/dt are magnitudes (V/s), times absolute (s, scope time base).
   */
  function analyze(sw, cur, opts = {}) {
    const o = Object.assign({}, DEFAULTS, opts);
    const v = sw.v, n = v.length, dt = sw.dt, tOf = x => sw.t0 + x * dt;
    const out = { edges: [], sigma: noiseSigma(v), iMean: cur ? mean(cur.v) : null, warn: [] };
    // clipping: the scope writes the ADC limit, so the record sits flat on its extreme for a
    // while; a noisy real waveform does not repeat its extreme value many samples in a row
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < n; i++) { if (v[i] < vmin) vmin = v[i]; if (v[i] > vmax) vmax = v[i]; }
    let runMax = 0, runMin = 0, rMax = 0, rMin = 0;
    for (let i = 0; i < n; i++) {
      rMax = v[i] === vmax ? rMax + 1 : 0; rMin = v[i] === vmin ? rMin + 1 : 0;
      if (rMax > runMax) runMax = rMax; if (rMin > runMin) runMin = rMin;
    }
    if (vmax > vmin && (runMax >= 8 || runMin >= 8)) out.warn.push('possibly clipped (flat at the record limit)');

    const s = smooth3(v);
    const found = findEdges(s, out.sigma);
    if (!found || !found.edges.length) { out.warn.push('no switching edge found'); return out; }
    const count = { rise: 0, fall: 0 };
    const E = found.edges;
    const sigS = out.sigma / Math.sqrt(3);
    for (let k = 0; k < E.length; k++) {
      const { dir, i } = E[k], kind = dir > 0 ? 'rise' : 'fall';
      const a = k ? E[k - 1].i : 0, b = k < E.length - 1 ? E[k + 1].i : n - 1;
      const e = { kind, n: ++count[kind], warn: [] };
      // settled levels: before the edge (leaving out the 15 % next to it) and the second half after it
      const preLen = i - a, postLen = b - i;
      if (preLen < 40 || postLen < 40) e.warn.push('edge too close to the record start/end or the neighbouring edge');
      e.base = medianOf(v, a + 0.3 * preLen, i - Math.max(5, 0.15 * preLen));
      e.top = medianOf(v, i + 0.5 * postLen, b - 0.1 * postLen);
      const topEarly = medianOf(v, i + 0.3 * postLen, i + 0.5 * postLen);
      e.swing = e.top - e.base;
      if (!(Math.abs(e.swing) > 10 * out.sigma) || Math.sign(e.swing) !== dir) { e.warn.push('levels around the edge unclear'); out.edges.push(e); continue; }
      if (Math.abs(topEarly - e.top) > 0.05 * Math.abs(e.swing)) e.warn.push('final level not settled within the record');
      const L = p => e.base + p * e.swing;
      // t50 near the coarse edge, then the other levels outwards from it (on raw samples)
      const x50 = crossing(v, L(0.5), i, -1, dir, a, b);
      if (x50 === null) { e.warn.push('no 50 % crossing'); out.edges.push(e); continue; }
      const i50 = Math.floor(x50);
      const xAt = p => p < 0.5 ? crossing(v, L(p), i50, -1, dir, a, b) : crossing(v, L(p), i50 + 1, 1, dir, a, b);
      const x10 = xAt(0.1), x90 = xAt(0.9), x20 = xAt(0.2), x80 = xAt(0.8);
      const sw2 = Math.abs(e.swing);
      e.t50 = tOf(x50);
      e.t10 = x10 === null ? null : tOf(x10); e.t90 = x90 === null ? null : tOf(x90);
      e.t20 = x20 === null ? null : tOf(x20); e.t80 = x80 === null ? null : tOf(x80);
      e.trise = x10 !== null && x90 !== null ? (x90 - x10) * dt : null;
      e.slew1090 = e.trise ? 0.8 * sw2 / e.trise : null;
      e.slew2080 = x20 !== null && x80 !== null && x80 > x20 ? 0.6 * sw2 / ((x80 - x20) * dt) : null;
      if (e.slew1090 === null) e.warn.push('10 % or 90 % level not crossed');
      // peak dv/dt: least-squares slope over dvdtWindow (2h+1 samples), between the 10 % and 90 % crossings
      const h = Math.max(1, Math.round(o.dvdtWindow / dt / 2));
      const ia = Math.max(h, Math.floor(x10 !== null ? x10 : x50) - h), ib = Math.min(n - 1 - h, Math.ceil(x90 !== null ? x90 : x50) + h);
      const den = h * (h + 1) * (2 * h + 1) / 3 * dt;
      let best = 0;
      for (let j = ia; j <= ib; j++) {
        let num = 0;
        for (let q = 1; q <= h; q++) num += q * (v[j + q] - v[j - q]);
        const d = dir * num / den;
        if (d > best) best = d;
      }
      e.dvdtMax = best || null;
      // overshoot beyond the settled level and first oscillation, on the smoothed signal
      const iw = Math.min(b, i50 + Math.round(o.ringWindow / dt));
      let pk = -Infinity;
      for (let j = i50; j <= iw; j++) pk = Math.max(pk, dir * s[j]);
      e.overshoot = Math.max(0, pk - dir * e.top);
      e.overshootPct = 100 * e.overshoot / sw2;
      // first oscillation: first local extreme after t50 (confirmed by a reversal of more than
      // hys), then the following opposite extreme; ringPP = their difference
      const hys = Math.max(5 * sigS, 0.02 * sw2);
      let runMax = -Infinity, jMax = -1, runMin = Infinity, phase = 0;
      e.ringPP = 0; e.tRing = null;
      for (let j = i50; j <= iw; j++) {
        const y = dir * s[j];
        if (phase === 0) {
          if (y > runMax) { runMax = y; jMax = j; }
          else if (y < runMax - hys) { phase = 1; runMin = y; }
        } else {
          if (y < runMin) runMin = y;
          else if (y > runMin + hys) break;
        }
      }
      if (phase === 1) { e.ringPP = runMax - runMin; e.tRing = tOf(jMax); }
      if (cur && cur.v.length) {
        const c0 = (e.t50 - o.curWindow - cur.t0) / cur.dt, c1 = (e.t50 - cur.t0) / cur.dt;
        e.iEdge = c1 >= 0 && c0 <= cur.v.length - 1 ? mean(cur.v, c0, c1) : null;
      } else e.iEdge = null;
      out.edges.push(e);
    }
    return out;
  }

  return { DEFAULTS, analyze, noiseSigma, findEdges };
})();
