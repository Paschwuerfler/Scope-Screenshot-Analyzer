// Time-series documents (CSV waveform exports): parsing, auto-scaling, decimated drawing.
//
// A series doc reuses the screenshot machinery through a "virtual image": x = sample index
// (width = number of samples), y = a fixed virtual height with a 10 × 8 div graticule. calib
// then maps x -> time exactly (uniform sampling) and y -> value per channel (scale/div and
// zeroY are the display settings). Cursors, readout and multi-period mode work unchanged;
// values are read from the samples directly (App.measure.valueAtX), not from pixels.
//
// Runtime (never persisted): doc.series = { t0, dt, n, cols: [{ id, name, unit, v: Float32Array, min, max }] }
// doc.blob is the CSV file, or after importing a compact session export a packed blob (pack / load).
//
// Merged views (combine): the columns come from several recordings, each keeping its own samples;
// such a column carries its own timing { t0, dt, part } and x (virtual sample index) is converted
// per column (colIndex). Always read and draw columns through valueAt / strokeSeries.
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
      cols.push({ id, name: hdr[c + 1].name, unit: hdr[c + 1].unit || 'V', v, ...range(v) });
    }
    return { t0, dt, n: nOut, cols, notes };
  }
  function range(v) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < v.length; i++) { const x = v[i]; if (x < min) min = x; if (x > max) max = x; }
    return { min, max };
  }

  // ---- compact storage (session export): parsed samples as gzip-compressed binary instead of CSV.
  // Layout before gzip: 'SSA1', uint32 LE header length, header JSON { enc, t0, dt, n, notes, cols },
  // then per column its samples split into byte planes (bytes 0 of all samples, then bytes 1, ...).
  //   'f32': float32 words XORed with the previous one, bit-exact (the app parses CSVs to float32)
  //   'q16': 65 536 levels from min to max, delta-coded; error ≤ half a level, stored per column
  const MAGIC = 'SSA1', TYPE = 'application/x-scope-series-';
  const PRECISION_RE = /^Stored at 16-bit precision/;
  const pipe = async (blob, stream) => new Uint8Array(await new Response(blob.stream().pipeThrough(stream)).arrayBuffer());
  function planes(bytes, k, inverse) {
    const m = bytes.length / k, out = new Uint8Array(bytes.length);
    for (let i = 0; i < m; i++) for (let j = 0; j < k; j++) {
      if (inverse) out[i * k + j] = bytes[j * m + i]; else out[j * m + i] = bytes[i * k + j];
    }
    return out;
  }
  /** 'f32' | 'q16' for a packed blob, null for CSV text. */
  const packedEnc = blob => (String(blob.type).match(/^application\/x-scope-series-(\w+)$/) || [])[1] || null;
  const isPrecisionNote = n => PRECISION_RE.test(n);

  /**
   * Pack a parsed series. enc 'f32' (lossless) | 'q16'. channels (optional, calib.channels) give the
   * displayed units for the error note. -> { blob, note } (note: q16 error text).
   */
  async function pack(s, enc, channels = {}) {
    const n = s.n, cols = [], data = [];
    for (const col of s.cols) {
      const c = { id: col.id, name: col.name, unit: col.unit };
      if (enc === 'f32') {
        const u = new Uint32Array(col.v.slice(0, n).buffer), x = new Uint32Array(n);
        for (let i = 0, p = 0; i < n; i++) { x[i] = u[i] ^ p; p = u[i]; }
        data.push(planes(new Uint8Array(x.buffer), 4));
      } else {
        const lo = col.min, step = (col.max - col.min) / 65535 || 1, d = new Uint16Array(n);
        let err = 0;
        for (let i = 0, p = 0; i < n; i++) {
          const q = Math.min(65535, Math.max(0, Math.round((col.v[i] - lo) / step)));
          err = Math.max(err, Math.abs(Math.fround(lo + q * step) - col.v[i]));
          d[i] = q - p; p = q;
        }
        Object.assign(c, { lo, step, err });
        data.push(planes(new Uint8Array(d.buffer), 2));
      }
      cols.push(c);
    }
    const note = enc === 'q16' ? `Stored at 16-bit precision (compact session export), max error ${cols.map(c => `${c.id} ±${App.util.formatSI(c.err, (channels[c.id] || c).unit, 2)}`).join(', ')}.` : null;
    const notes = [...(note ? [note] : []), ...s.notes.filter(x => !isPrecisionNote(x))];
    const head = new TextEncoder().encode(JSON.stringify({ enc, t0: s.t0, dt: s.dt, n, notes, cols }));
    const pre = new Uint8Array(8);
    pre.set(new TextEncoder().encode(MAGIC)); new DataView(pre.buffer).setUint32(4, head.length, true);
    const gz = await pipe(new Blob([pre, head, ...data]), new CompressionStream('gzip'));
    return { blob: new Blob([gz], { type: TYPE + enc }), note };
  }

  /** Inverse of pack -> the same { t0, dt, n, cols, notes } as parse(). */
  async function unpack(blob) {
    const b = await pipe(blob, new DecompressionStream('gzip'));
    if (new TextDecoder().decode(b.subarray(0, 4)) !== MAGIC) throw new Error('unknown compact series format');
    const hl = new DataView(b.buffer, b.byteOffset).getUint32(4, true);
    const h = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + hl))), n = h.n;
    let off = 8 + hl;
    const cols = h.cols.map(c => {
      const v = new Float32Array(n);
      if (h.enc === 'f32') {
        const x = new Uint32Array(planes(b.subarray(off, off += 4 * n), 4, true).buffer), u = new Uint32Array(v.buffer);
        for (let i = 0, p = 0; i < n; i++) { p ^= x[i]; u[i] = p; }
      } else {
        const d = new Uint16Array(planes(b.subarray(off, off += 2 * n), 2, true).buffer);
        for (let i = 0, q = 0; i < n; i++) { q = (q + d[i]) & 0xFFFF; v[i] = c.lo + q * c.step; }
      }
      return { id: c.id, name: c.name, unit: c.unit, v, ...range(v) };
    });
    return { t0: h.t0, dt: h.dt, n, cols, notes: h.notes };
  }

  /** Parsed series from a stored blob: CSV text or packed. */
  const load = async blob => packedEnc(blob) ? unpack(blob) : parse(await readText(blob));

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

  /** Fractional index into col.v for virtual sample index x (differs only in merged views). */
  const colIndex = (s, col, x) => (col.dt ? (s.t0 + x * s.dt - col.t0) / col.dt : x);

  /** Value of a column at fractional sample index x (linear interpolation), or null. */
  function valueAt(s, chId, x) {
    const col = s && s.cols.find(c => c.id === chId);
    if (!col) return null;
    const n = col.v.length;
    let i = colIndex(s, col, x);
    if (Math.abs(i) < 1e-6) i = 0; else if (Math.abs(i - (n - 1)) < 1e-6) i = n - 1;   // float residue at the ends
    if (!(i >= 0 && i <= n - 1)) return null;
    const k = Math.min(n - 2, Math.floor(i)), a = i - k;
    return col.v[k] + (col.v[k + 1] - col.v[k]) * a;
  }

  /**
   * Merged view of several recordings. parts = [{ name, shift, map: { srcId: id } }] (shift in s,
   * map = which source column becomes which channel), data = their parsed series (load()).
   * Columns keep their samples and get their own timing (t0 incl. shift, dt); the virtual sample
   * grid spans all parts at the finest dt. -> the same shape as parse() (+ col.t0/dt/part).
   */
  function combine(parts, data) {
    const cols = [];
    let t0 = Infinity, t1 = -Infinity, dt = Infinity;
    parts.forEach((p, k) => {
      const s = data[k], a = s.t0 + (p.shift || 0);
      for (const c of s.cols) if (p.map[c.id]) cols.push({ ...c, id: p.map[c.id], t0: a, dt: s.dt, part: k });
      t0 = Math.min(t0, a); t1 = Math.max(t1, a + (s.n - 1) * s.dt); dt = Math.min(dt, s.dt);
    });
    cols.sort((a, b) => a.id.localeCompare(b.id));
    // the grid is virtual (nothing is allocated per sample), cap it only to stay well inside integers
    dt = Math.max(dt, (t1 - t0) / 1e9);
    const n = Math.max(2, Math.round((t1 - t0) / dt) + 1);
    const notes = parts.flatMap((p, k) => data[k].notes.map(x => `${p.name}: ${x}`));
    return { t0, dt, n, cols, notes };
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
  /** strokeColumn for a column of series s, with sxOf mapping the virtual sample index (merged views). */
  function strokeSeries(ctx, s, col, xa, xb, sxOf, syOf, pxWidth) {
    if (!col.dt) return strokeColumn(ctx, col, xa, xb, sxOf, syOf, pxWidth);
    const k = col.dt / s.dt, a = (col.t0 - s.t0) / s.dt;
    strokeColumn(ctx, col, (xa - a) / k, (xb - a) / k, i => sxOf(a + i * k), syOf, pxWidth);
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
      strokeSeries(ctx, s, col, 0, s.n - 1, i => i / (s.n - 1) * (W - 1), v => App.calib.yAt(c, col.id, v) / VH * H, W);
    }
    return new Promise(res => cv.toBlob(b => res(URL.createObjectURL(b))));
  }

  return { VH, isSeriesFile, readText, parse, load, pack, packedEnc, isPrecisionNote, autoNames, autoCalib, axisChannel, setScale, gridDiv, rateText, valueAt, colIndex, combine, strokeColumn, strokeSeries, thumbnail };
})();
