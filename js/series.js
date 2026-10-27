// Time-series documents (CSV waveform exports): parsing, auto-scaling, decimated drawing.
//
// A series doc reuses the screenshot machinery through a "virtual image": x = sample index
// (width = number of samples), y = a fixed virtual height with a 10 × 8 div graticule. calib
// then maps x -> time exactly (uniform sampling) and y -> value per channel (scale/div and
// zeroY are the display settings). Cursors, readout and multi-period mode work unchanged;
// values are read from the samples directly (App.measure.valueAtX), not from pixels.
//
// Runtime (never persisted): doc.series = { t0, dt, n, cols: [{ id, name, unit, v: Float32Array, min, max }] }
App.series = (() => {
  const VH = 800;                      // virtual height (px) of the graticule
  const RE = /\.(csv|txt|tsv|dat)$/i;
  const isSeriesFile = f => RE.test(f.name || '') || /^text\/(csv|plain|tab-separated-values)/.test(f.type || '');
  const UNIT_SCALE = { '': 1, G: 1e9, M: 1e6, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12 };

  /** File text; LTspice and some Windows tools write UTF-16, which Blob.text() would garble. */
  async function readText(blob) {
    const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (b[0] === 0xFF && b[1] === 0xFE || b.length > 1 && b[0] && !b[1]) return new TextDecoder('utf-16le').decode(await blob.arrayBuffer());
    if (b[0] === 0xFE && b[1] === 0xFF || b.length > 1 && !b[0] && b[1]) return new TextDecoder('utf-16be').decode(await blob.arrayBuffer());
    return blob.text();
  }

  /**
   * "C1 in V" | "CH2(mV)" | "Current [A]" | "Time" | SPICE "V(out)", "I(R1)", "Ix(U1:D)"
   * -> { name, unit, scale } (scale converts to SI).
   */
  function parseHeader(h) {
    const s = String(h || '').trim().replace(/^"|"$/g, '');
    const sp = s.match(/^(V|I[a-z]?)\((.+)\)$/i);
    if (sp && !/^[GMkmuµμnp]?(s|V|A|W|Hz|Ohm|Ω|°C|K)$/.test(sp[2])) return { name: s, unit: /^v/i.test(sp[1]) ? 'V' : 'A', scale: 1 };
    const m = s.match(/^(.*?)\s*(?:\bin\s+([^\s]+)|\[([^\]]+)\]|\(([^)]+)\))\s*$/i);
    const name = (m ? m[1] : s).trim() || s;
    let unit = m ? (m[2] || m[3] || m[4]) : '', scale = 1;
    const um = unit.match(/^([GMkmuµμnp]?)(s|V|A|W|Hz|Ohm|Ω|°C|K)$/);
    if (um && um[1]) { scale = UNIT_SCALE[um[1]]; unit = um[2]; }
    return { name, unit, scale };
  }

  /**
   * Parse CSV text. Skips leading metadata lines, detects delimiter (, ; tab) and decimal comma.
   * First numeric column = time, up to 4 more columns become channels C1..C4.
   * Returns { t0, dt, n, cols, notes }.
   */
  function parse(text) {
    let lines = text.split(/\r?\n/);
    const notes = [];
    if (/^\s*"?freq/i.test(lines[0] || '')) throw new Error('frequency-domain (AC) export, only time-domain data is supported');
    // LTspice .step export: "Step Information: R=1 (Run: 1/3)" before each run -> keep run 1
    const steps = lines.reduce((a, l, i) => (/^Step Information:/i.test(l) && a.push(i), a), []);
    if (steps.length > 1) {
      notes.push(`${steps.length} stepped runs (LTspice .step) — only run 1 is shown (${lines[steps[0]].replace(/^Step Information:\s*/i, '').trim()}).`);
      lines = lines.slice(0, steps[1]);
    }
    // delimiter: the one giving a consistent field count >= 2 on a data-looking line
    let delim = null, first = -1;
    const numRe = /^\s*"?[-+]?(\d+[.,]?\d*|[.,]\d+)([eE][-+]?\d+)?"?\s*$/;
    for (let i = 0; i < Math.min(lines.length, 200) && first < 0; i++) {
      for (const d of [',', ';', '\t']) {
        const f = lines[i].split(d);
        if (f.length >= 2 && f.every(x => numRe.test(x))) {
          // a comma could also be a decimal comma: then ';' or tab must split it
          if (d === ',' && (lines[i].includes(';') || lines[i].includes('\t'))) continue;
          delim = d; first = i; break;
        }
      }
    }
    if (first < 0) throw new Error('no numeric data columns found');
    const nf = lines[first].split(delim).length;
    const decComma = delim !== ',' && /\d,\d/.test(lines[first]);
    // header: closest preceding line with the same number of fields
    let head = null;
    for (let i = first - 1; i >= 0; i--) { const f = lines[i].split(delim); if (f.length === nf) { head = f; break; } }
    const hdr = (head || Array.from({ length: nf }, (_, k) => k ? `C${k}` : 'Time')).map(parseHeader);
    let nCh = nf - 1;
    if (nCh > 4) { notes.push(`${nCh} data columns — only the first 4 are shown.`); nCh = 4; }

    // numbers
    const N0 = lines.length - first;
    const t = new Float64Array(N0), vals = Array.from({ length: nCh }, () => new Float32Array(N0));
    let n = 0;
    for (let i = first; i < lines.length; i++) {
      let ln = lines[i];
      if (!ln) continue;
      if (decComma) ln = ln.replace(/,/g, '.');
      const f = ln.split(delim);
      if (f.length < nCh + 1) continue;
      const tv = parseFloat(f[0].replace(/"/g, ''));
      if (!isFinite(tv)) continue;
      t[n] = tv * hdr[0].scale;
      for (let c = 0; c < nCh; c++) vals[c][n] = parseFloat(f[c + 1].replace(/"/g, '')) * hdr[c + 1].scale;
      n++;
    }
    if (n < 2) throw new Error('fewer than 2 samples');
    const t0 = t[0], span = t[n - 1] - t0;
    let dt = span / (n - 1), nOut = n;
    if (!(dt > 0)) throw new Error('time column is not increasing');
    // uniform sampling check; resample linearly if needed (e.g. SPICE output with adaptive steps)
    let maxDev = 0;
    for (let i = 0; i < n; i += Math.max(1, n >> 12)) maxDev = Math.max(maxDev, Math.abs(t[i] - (t0 + i * dt)));
    if (maxDev > 0.05 * dt) {
      // grid step = median step, so dense regions (edges) keep their detail; capped in size
      const st = new Float64Array(n - 1);
      for (let i = 1; i < n; i++) st[i - 1] = t[i] - t[i - 1];
      st.sort();
      const med = st[st.length >> 1];
      if (med > 0 && med < dt) nOut = Math.min(4e6, Math.max(n, Math.ceil(span / med) + 1));
      dt = span / (nOut - 1);
      notes.push(`Time steps are not uniform — resampled linearly to ${nOut} points at ${App.util.formatSI(dt, 's')}.`);
      for (let c = 0; c < nCh; c++) {
        const src = vals[c], dst = new Float32Array(nOut);
        let j = 0;
        for (let i = 0; i < nOut; i++) {
          const ti = t0 + i * dt;
          while (j < n - 2 && t[j + 1] < ti) j++;
          const a = (ti - t[j]) / (t[j + 1] - t[j] || 1);
          dst[i] = src[j] + (src[j + 1] - src[j]) * Math.max(0, Math.min(1, a));
        }
        vals[c] = dst;
      }
    }
    // channel ids: "C2"/"CH2" -> C2, otherwise next free slot
    const used = new Set(), cols = [];
    const ids = hdr.slice(1, nCh + 1).map(h => {
      const m = h.name.match(/^(?:C|CH|Channel)\s*([1-4])\b/i), id = m && 'C' + m[1];
      if (!id || used.has(id)) return null;
      used.add(id); return id;
    });
    for (let c = 0; c < nCh; c++) {
      let id = ids[c];
      if (!id) { id = ['C1', 'C2', 'C3', 'C4'].find(x => !used.has(x)); used.add(id); }
      const v = vals[c].length === nOut ? vals[c] : vals[c].slice(0, nOut);
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < nOut; i++) { const x = v[i]; if (x < min) min = x; if (x > max) max = x; }
      cols.push({ id, name: hdr[c + 1].name, unit: hdr[c + 1].unit || 'V', v, min, max });
    }
    return { t0, dt, n: nOut, cols, notes };
  }

  /**
   * Default channel names from the column headers: generic "C1" / "CH2" / "Channel 3" give none,
   * anything else is kept (SPICE "V(out)" -> "Vout"). -> { C1: 'Vout', ... }
   */
  function autoNames(s) {
    const out = {};
    for (const col of s.cols) {
      const n = col.name.trim();
      if (!n || /^(?:C|CH|Channel)\s*[1-4]$/i.test(n)) continue;
      out[col.id] = n.replace(/^([VI][a-z]?)\((.+)\)$/i, '$1$2');
    }
    return out;
  }

  // 1-2-5 sequence >= x
  function nice125(x) {
    if (!(x > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(x))), m = x / e;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
  }

  /** Fresh calib + status for a parsed series (auto scale: each channel spans ~6 of 8 divs, centred). */
  function autoCalib(s) {
    const W = s.n, c = App.calib.emptyCalib(W, VH);
    c.grid = { left: 0, right: W - 1, top: 0, bottom: VH, hdiv: 10, vdiv: 8 };
    c.time = { tdiv: (W - 1) * s.dt / 10, tCenter: s.t0 + (W - 1) * s.dt / 2 };
    const status = { time: { tdiv: 'ok', tCenter: 'ok' }, channels: {}, grid: 'ok' };
    const ppd = VH / 8;
    for (const col of s.cols) {
      const vdiv = nice125((col.max - col.min) / 6 || Math.abs(col.max) / 3 || 1);
      const mid = (col.max + col.min) / 2;
      // centre value snapped to half a division so the 0 level stays readable
      const centre = Math.round(mid / (vdiv / 2)) * (vdiv / 2);
      c.channels[col.id] = { on: true, vdiv, unit: col.unit, zeroY: VH / 2 + centre / vdiv * ppd };
      status.channels[col.id] = { vdiv: 'ok', zeroY: 'ok' };
    }
    return { calib: c, status };
  }

  /**
   * Channel whose values label the y axis (colour-coded, like a scope): the one picked last
   * (doc.axisCh: probe toggled on, handle dragged / scrolled, chip clicked in the Display panel),
   * else the first probed channel, else the first one on.
   */
  function axisChannel(d) {
    const on = id => d.calib.channels[id] && d.calib.channels[id].on;
    if (d.axisCh && on(d.axisCh)) return d.axisCh;
    return App.measure.probedChannels(d).find(on) || d.series.cols.map(c => c.id).find(on) || null;
  }

  /**
   * Change a channel's display scale keeping the value at virtual y `anchorY` where it is
   * (anchorY = grid centre: like a scope's scale knob; anchorY = zeroY: 0 level stays put).
   */
  function setScale(doc, chId, vdiv, anchorY = VH / 2) {
    const ch = doc.calib.channels[chId];
    ch.zeroY = anchorY + (ch.zeroY - anchorY) * ch.vdiv / vdiv;
    ch.vdiv = vdiv;
  }
  /** Time/div for a visible span: the 1-2-5 value closest (log scale) to span / 10, so 6–16 divs show. */
  function gridDiv(span) {
    const target = span / 10, e = Math.pow(10, Math.floor(Math.log10(target)));
    let best = e, bd = Infinity;
    for (const m of [1, 2, 5, 10]) { const dd = Math.abs(Math.log(m * e / target)); if (dd < bd) { bd = dd; best = m * e; } }
    return best;
  }
  const rateText = s => `${App.util.formatSI(1 / s.dt, 'Sa/s')}`;

  /** Value of a column at fractional sample index x (linear interpolation), or null. */
  function valueAt(s, chId, x) {
    const col = s && s.cols.find(c => c.id === chId);
    if (!col || x < 0 || x > s.n - 1) return null;
    const i = Math.min(s.n - 2, Math.floor(x)), a = x - i;
    return col.v[i] + (col.v[i + 1] - col.v[i]) * a;
  }

  /**
   * Stroke the waveform of one column between sample indices xa..xb into ctx, mapping
   * sample index -> screen x with sx(i) and value -> screen y with sy(v). Above one sample
   * per pixel it draws a min/max envelope per screen column (no aliasing, no lost spikes).
   */
  function strokeColumn(ctx, col, xa, xb, sxOf, syOf, pxWidth) {
    const n = col.v.length, v = col.v;
    const i0 = Math.max(0, Math.floor(xa)), i1 = Math.min(n - 1, Math.ceil(xb));
    if (i1 <= i0) return;
    const spp = (i1 - i0) / Math.max(1, pxWidth);
    ctx.beginPath();
    if (spp <= 2) {
      for (let i = i0; i <= i1; i++) { const X = sxOf(i), Y = syOf(v[i]); if (i === i0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
    } else {
      const X0 = Math.floor(sxOf(i0)), X1 = Math.ceil(sxOf(i1));
      let i = i0;
      for (let X = X0; X <= X1; X++) {
        const iEnd = Math.min(i1, Math.floor(i0 + (X + 1 - X0) * (i1 - i0) / Math.max(1, X1 - X0)));
        if (iEnd < i) continue;
        let lo = Infinity, hi = -Infinity;
        for (; i <= iEnd; i++) { const y = v[i]; if (y < lo) lo = y; if (y > hi) hi = y; }
        const a = syOf(hi), b = syOf(lo);
        if (X === X0) ctx.moveTo(X + 0.5, a); else ctx.lineTo(X + 0.5, a);
        ctx.lineTo(X + 0.5, b + (b - a < 1 ? 1 : 0));
      }
    }
    ctx.stroke();
  }

  /** Small preview image (object URL) for the thumbnail strip. */
  function thumbnail(doc) {
    const W = 320, H = 206, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), c = doc.calib, s = doc.series;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 1; k < 10; k++) { const x = Math.round(W * k / 10) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let k = 1; k < 8; k++) { const y = Math.round(H * k / 8) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const col of s.cols) {
      if (!c.channels[col.id].on) continue;
      ctx.strokeStyle = App.calib.channelById(col.id).color;
      strokeColumn(ctx, col, 0, s.n - 1, i => i / (s.n - 1) * (W - 1), v => App.calib.yAt(c, col.id, v) / VH * H, W);
    }
    return new Promise(res => cv.toBlob(b => res(URL.createObjectURL(b))));
  }

  return { VH, isSeriesFile, readText, parse, autoNames, autoCalib, axisChannel, setScale, gridDiv, rateText, valueAt, strokeColumn, thumbnail };
})();
