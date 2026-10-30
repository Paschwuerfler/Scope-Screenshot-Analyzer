// DPT page UI: pool list, edge overlay, trend plot (metric vs parameter), edge table and the
// add / edit batch dialog, right-click menu on shots. Plain template strings, re-rendered on 'pool-changed'; hover and
// pinned shots are shared by all views (syncHighlight).
App.dpt.ui = (() => {
  const $ = s => document.querySelector(s);
  const P = App.dpt.plot, U = App.util, pool = App.dpt.pool;
  const esc = U.escapeHtml;
  const PREFS_KEY = 'dpt-prefs';
  const prefs = Object.assign({ edge: null, color: 'I', metric: 'slew1090', x: 'I', groups: ['Folder'], repeats: 'sd', logX: false, filter: '', sort: null, view: null, collapse: false }, loadPrefs());
  if (typeof prefs.group === 'string') { prefs.groups = prefs.group ? [prefs.group] : []; delete prefs.group; }   // prefs before multi-key grouping
  let hover = null;              // shot id under the mouse (any view)
  const pinned = new Set();      // shot ids pinned by click
  const collapsed = new Set();   // batch ids collapsed in the pool list

  /** Metrics on the trend Y axis / table. rate: V/s shown as V/ns etc.; zero: axis starts at 0. */
  const METRICS = [
    { key: 'slew1090', label: 'Slew rate 10–90 %', unit: 'V/s', rate: true },
    { key: 'slew2080', label: 'Slew rate 20–80 %', unit: 'V/s', rate: true },
    { key: 'dvdtMax', label: 'Peak dv/dt', unit: 'V/s', rate: true },
    { key: 'trise', label: 'Rise / fall time 10–90 %', unit: 's', zero: true },
    { key: 'overshoot', label: 'Overshoot', unit: 'V', zero: true },
    { key: 'overshootPct', label: 'Overshoot (% of swing)', unit: '%', zero: true },
    { key: 'ringPP', label: 'Ringing pk-pk (1st oscillation)', unit: 'V', zero: true },
    { key: 'fRing', label: 'Ringing frequency', unit: 'Hz', zero: true },
    { key: 'swing', label: 'Swing', unit: 'V' },
    { key: 'base', label: 'Level before edge', unit: 'V' },
    { key: 'top', label: 'Level after edge', unit: 'V' },
  ];
  const metric = k => METRICS.find(m => m.key === k) || METRICS[0];
  const fmtMetric = (m, v) => v === null || v === undefined || !isFinite(v) ? '–' : m.rate ? U.formatRate(v) : m.unit === '%' ? v.toFixed(1) + ' %' : U.formatSI(v, m.unit, 4);

  function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } }

  // ---------------------------------------------------------------- data helpers
  const allRows = () => pool.rows(prefs.edge).filter(r => r.edge);
  const shownRows = () => { const f = compileFilter(prefs.filter); return allRows().filter(f.test); };
  const visRows = () => shownRows().filter(r => !r.shot.hidden);
  const swCol = r => r.shot.cols[r.batch.roles.sw];
  const keyInfo = k => pool.paramKeys().find(x => x.key === k);
  function fmtParam(k, v) {
    if (v === null || v === undefined) return '–';
    if (typeof v !== 'number') return String(v);
    const info = keyInfo(k);
    return U.formatSI(v, info ? info.unit : '', 3);
  }

  /** Colour per row: numeric parameter -> sequential ramp (log when it spans > 20×), text -> categorical. */
  function colorizer() {
    const info = keyInfo(prefs.color) || keyInfo('I');
    const rows = allRows(), get = r => r.p[info.key];
    if (info.numeric) {
      const vals = rows.map(get).filter(v => typeof v === 'number' && isFinite(v));
      let lo = Math.min(...vals), hi = Math.max(...vals);
      const log = lo > 0 && hi / lo > 20, f = v => log ? Math.log(v) : v;
      const span = f(hi) - f(lo) || 1;
      return { kind: 'seq', info, lo, hi, log, of: r => P.seq((f(get(r)) - f(lo)) / span) };
    }
    const cats = [];
    for (const r of rows) { const v = String(get(r)); if (!cats.includes(v)) cats.push(v); }
    return { kind: 'cat', info, cats, of: r => P.CATEGORICAL[cats.indexOf(String(get(r)))] || P.INK.fg2 };
  }

  // ---------------------------------------------------------------- filter
  /**
   * Shot filter from text; terms are separated by spaces or ';' and must all match:
   *   I~10A  around 10 A (±10 %), I~10A±2A or I~10±20% for another tolerance
   *   I=8..12A (an open end is allowed: I=..5A)   I>5A   I<=2A   RHR=330   VCC!=24   Folder=33045A24
   *   ~10A  >5A  without a key = shot current I · plain text = folder or shot name contains it
   * Keys are the parameter names (case-insensitive) plus I, Folder, Shot.
   * Returns { test(row), bad: [terms that could not be read], n: number of terms }.
   */
  function compileFilter(text) {
    const terms = [], bad = [];
    const src = String(text || '')
      .replace(/\s*(<=|>=|!=|=|<|>|~|±|\.\.)\s*/g, '$1')
      .replace(/(\d)\s+(?=[GMkKmuµμnpf]?(?:Ω|Ohm|[A-Za-z]{1,2}|%)(?:[\s;]|$))/g, '$1');   // "10 A" -> "10A"
    for (const t of src.split(/[\s;]+/).filter(Boolean)) {
      const m = t.match(/^([^<>=!~]*?)(<=|>=|!=|=|<|>|~)(.*)$/);
      if (!m) { const q = t.toLowerCase(); terms.push(r => `${r.batch.name} ${r.shot.label}`.toLowerCase().includes(q)); continue; }
      const f = filterTerm(m[1] || 'I', m[2], m[3]);
      if (f) terms.push(f); else bad.push(t);
    }
    return { test: r => terms.every(f => f(r)), bad, n: terms.length };
  }
  function filterTerm(key, op, val) {
    const norm = k => k.toLowerCase().replace(/[\s_]/g, ''), lk = norm(key);
    const k = lk === 'shot' ? 'Shot' : (pool.paramKeys().find(x => norm(x.key) === lk) || {}).key;
    if (!k || val === '') return null;
    const get = k === 'Shot' ? r => r.shot.label : r => r.p[k];
    const num = s => pool.param('', s).value;            // number with SI prefix / unit, null if not numeric
    const isNum = v => typeof v === 'number' && isFinite(v);
    const onNum = test => r => { const v = get(r); return isNum(v) && test(v); };
    if (op === '~') {
      const [c0, t0] = val.split('±'), c = num(c0);
      if (c === null) return null;
      let tol = Math.abs(c) * 0.1;
      if (t0 !== undefined) {
        const pct = t0.endsWith('%'), t = num(pct ? t0.slice(0, -1) : t0);
        if (t === null) return null;
        tol = pct ? Math.abs(c) * t / 100 : Math.abs(t);
      }
      return onNum(v => Math.abs(v - c) <= tol);
    }
    if (op === '=' || op === '!=') {
      let f;
      if (val.includes('..')) {
        const [a0, b0] = val.split('..'), a = a0 ? num(a0) : -Infinity, b = b0 ? num(b0) : Infinity;
        if (a === null || b === null) return null;
        f = onNum(v => v >= Math.min(a, b) && v <= Math.max(a, b));
      } else {
        const c = num(val), q = val.toLowerCase();
        f = r => { const v = get(r); return c !== null && isNum(v) ? Math.abs(v - c) <= 1e-6 * Math.abs(c) : String(v ?? '').toLowerCase() === q; };
      }
      return op === '=' ? f : r => !f(r);
    }
    const c = num(val);
    if (c === null) return null;
    return onNum({ '<': v => v < c, '>': v => v > c, '<=': v => v <= c, '>=': v => v >= c }[op]);
  }
  function renderFilter() {
    const inp = $('#flt'), f = compileFilter(prefs.filter);
    if (inp.value !== prefs.filter && document.activeElement !== inp) inp.value = prefs.filter;
    inp.classList.toggle('invalid', f.bad.length > 0);
    inp.title = f.bad.length ? `Not understood (ignored): ${f.bad.join('  ')}` : inp.dataset.help;
    $('#flt-clear').hidden = !prefs.filter;
  }
  function setFilter(text) {
    prefs.filter = text; savePrefs();
    renderFilter(); renderPool(); renderTable(); drawOverlay(); drawTrend();
  }
  function initFilter() {
    const inp = $('#flt'), apply = U.debounce(() => setFilter(inp.value), 150);
    inp.dataset.help = inp.title;
    inp.addEventListener('input', apply);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); if (inp.value) { inp.value = ''; setFilter(''); } else inp.blur(); }
      else if (e.key === 'Enter') inp.blur();
    });
    $('#flt-clear').addEventListener('click', () => { inp.value = ''; setFilter(''); });
  }
  const focusFilter = () => { $('#flt').focus(); $('#flt').select(); };

  // ---------------------------------------------------------------- selects
  function fillSelect(sel, opts, value) {
    sel.innerHTML = opts.map(o => `<option value="${esc(o.value)}"${o.value === value ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    if (!opts.some(o => o.value === value) && opts.length) sel.value = opts[0].value;
    return sel.value;
  }
  const EDGE_LABEL = k => `${k.startsWith('rise') ? 'Rising' : 'Falling'} edge ${k.replace(/\D/g, '')}`;
  function renderSelects() {
    const keys = pool.paramKeys(), edges = pool.edgeKeys();
    prefs.edge = fillSelect($('#sel-edge'), edges.map(k => ({ value: k, label: EDGE_LABEL(k) })), prefs.edge) || null;
    prefs.color = fillSelect($('#sel-color'), keys.map(k => ({ value: k.key, label: k.label })), prefs.color);
    prefs.metric = fillSelect($('#sel-metric'), METRICS.map(m => ({ value: m.key, label: m.label })), prefs.metric);
    prefs.x = fillSelect($('#sel-x'), keys.filter(k => k.numeric).map(k => ({ value: k.key, label: k.label })), prefs.x);
    renderGroupSelects(keys);
    $('#sel-repeats').value = prefs.repeats;
    $('#tgl-logx').classList.toggle('on', !!prefs.logX);
  }
  /**
   * Group by: one select per key in prefs.groups plus an empty one to add another key, so
   * SC + RHR gives one line per (SC, RHR) pair. Choosing 'none' in a select drops that key.
   */
  function renderGroupSelects(keys) {
    const avail = keys.filter(k => k.key !== prefs.x);
    prefs.groups = prefs.groups.filter((g, i) => avail.some(k => k.key === g) && prefs.groups.indexOf(g) === i);
    const sels = [...prefs.groups, ''].slice(0, avail.length);
    $('#sel-groups').innerHTML = sels.map((g, i) => {
      const opts = [{ value: '', label: i ? '+' : 'none' }, ...avail.filter(k => k.key === g || !prefs.groups.includes(k.key)).map(k => ({ value: k.key, label: k.label }))];
      return `<select data-gi="${i}" title="${i ? 'Also split by this parameter' : 'One line, colour and marker per value of this parameter'}">${
        opts.map(o => `<option value="${esc(o.value)}"${o.value === g ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    }).join('');
  }
  function initGroupSelects() {
    $('#sel-groups').addEventListener('change', e => {
      const i = +e.target.dataset.gi, v = e.target.value, g = prefs.groups.slice();
      if (v) g[i] = v; else g.splice(i, 1);
      prefs.groups = g; savePrefs();
      renderGroupSelects(pool.paramKeys()); drawTrend();
      const next = $(`#sel-groups [data-gi="${v ? i : Math.max(0, i - 1)}"]`);
      if (next) next.focus();                      // keep keyboard focus after the re-render
    });
  }
  /** A select bound to prefs[key]; redraw = what depends on it (default: everything). */
  function onSelect(id, key, redraw = renderAll) {
    $(id).addEventListener('change', e => { prefs[key] = e.target.value; if (key === 'edge') prefs.view = null; savePrefs(); redraw(); });
  }

  // ---------------------------------------------------------------- pool list
  function renderPool() {
    const col = colorizer(), byShot = new Map(allRows().map(r => [r.shot.id, r])), flt = compileFilter(prefs.filter);
    const n = pool.shots.length;
    $('#pool-count').textContent = n ? `${pool.batches.length} folder${pool.batches.length > 1 ? 's' : ''} · ${n} shots` : '';
    $('#pool-list').innerHTML = pool.batches.map(b => {
      const sh = pool.shots.filter(s => s.batchId === b.id), on = sh.filter(s => !s.hidden).length;
      const params = b.params.filter(p => p.key).map(p => `${esc(p.key)} = ${esc(p.value !== null ? U.formatSI(p.value, p.unit, 4) : p.text)}`).join(' · ');
      return `<details class="batch" data-batch="${b.id}"${collapsed.has(b.id) ? '' : ' open'}>
        <summary><input type="checkbox" data-bact="toggle" title="Show / hide all shots of this folder"${on === sh.length ? ' checked' : ''}${on && on < sh.length ? ' data-mixed="1"' : ''}>
          <span class="batch-name" title="${esc(b.name)}">${esc(b.name)}</span><span class="muted">${sh.length}</span>
          <span class="batch-btns"><button data-bact="edit" title="Edit name, parameters, channels and shot currents">Edit</button><button data-bact="remove" class="danger" title="Remove this folder from the pool">×</button></span></summary>
        <div class="batch-params">${params || '<i>no parameters</i>'} · ${esc(b.roles.sw)} switch node, ${esc(b.roles.cur || 'no')} current</div>
        <ul class="shot-list">${sh.map(s => {
          const r = byShot.get(s.id), warn = shotWarnings(s, r && r.edge);
          const out = r && flt.n && !flt.test(r);
          return `<li class="shot${s.hidden ? ' off' : ''}${out ? ' filtered' : ''}" data-shot="${s.id}"${out ? ' title="Hidden by the filter"' : ''}>
            <input type="checkbox" data-sact="toggle"${s.hidden ? '' : ' checked'} title="Show in plots and table">
            <span class="swatch" style="background:${r ? col.of(r) : 'transparent'}"></span>
            <span class="shot-label">${esc(s.label)}</span>
            <span class="shot-i">${U.formatSI(pool.shotCurrent(s), 'A', 3)}${s.current !== null && s.current !== undefined ? '*' : ''}</span>
            ${warn.length ? `<span class="badge warn" title="${esc(warn.join('\n'))}">!</span>` : ''}</li>`;
        }).join('')}</ul></details>`;
    }).join('');
    for (const cb of document.querySelectorAll('[data-mixed]')) cb.indeterminate = true;
    syncHighlight(false);
  }
  function shotWarnings(s, edge) {
    const w = s.res ? [...s.res.warn] : [];
    if (edge) w.push(...edge.warn);
    else if (prefs.edge && s.res && s.res.edges.length) w.push(`no ${EDGE_LABEL(prefs.edge).toLowerCase()} in this shot`);
    return w;
  }

  function initPoolEvents() {
    const list = $('#pool-list');
    list.addEventListener('click', e => {
      const bEl = e.target.closest('[data-batch]'), sEl = e.target.closest('[data-shot]');
      const bact = e.target.dataset.bact, sact = e.target.dataset.sact;
      if (bact === 'toggle' && bEl) {
        const ids = pool.shots.filter(s => s.batchId === bEl.dataset.batch).map(s => s.id);
        pool.updateShots(ids, { hidden: !e.target.checked });
      } else if (bact === 'edit') { e.preventDefault(); openBatchDialog({ batchId: bEl.dataset.batch }); }
      else if (bact === 'remove') {
        e.preventDefault();
        const b = pool.batches.find(x => x.id === bEl.dataset.batch);
        if (confirm(`Remove folder "${b.name}" and its shots from the pool?`)) pool.removeBatch(b.id);
      } else if (sact === 'toggle' && sEl) pool.updateShots(sEl.dataset.shot, { hidden: !e.target.checked });
      else if (sEl) togglePin(sEl.dataset.shot);
    });
    list.addEventListener('toggle', e => {
      const id = e.target.dataset && e.target.dataset.batch;
      if (id) { if (e.target.open) collapsed.delete(id); else collapsed.add(id); }
    }, true);
    list.addEventListener('mouseover', e => { const s = e.target.closest('[data-shot]'); setHover(s ? s.dataset.shot : null); });
    list.addEventListener('mouseleave', () => setHover(null));
  }
  /** Scroll the pool list to a shot (opening its folder) so the folder parameters are in view, and flash it. */
  function revealShot(id) {
    const li = $('#pool-list').querySelector(`[data-shot="${id}"]`);
    if (!li) return;
    const det = li.closest('details');
    det.open = true;
    collapsed.delete(det.dataset.batch);
    // the folder header holds the parameters: show it too when the folder fits, else centre the shot
    const list = $('#pool-list'), L = list.getBoundingClientRect();
    const top = det.getBoundingClientRect().top - L.top + list.scrollTop, bottom = li.getBoundingClientRect().bottom - L.top + list.scrollTop;
    list.scrollTop = bottom - top <= list.clientHeight ? top - 6 : bottom - list.clientHeight / 2;
    li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
  }

  // ---------------------------------------------------------------- highlight (hover / pin)
  function setHover(id) { if (hover === id) return; hover = id; syncHighlight(); }
  function togglePin(id) { if (pinned.has(id)) pinned.delete(id); else pinned.add(id); syncHighlight(); }
  /** Pin all ids, or unpin them when all are pinned already (repeat point, collapsed table entry). */
  function togglePins(ids) {
    const on = !ids.every(id => pinned.has(id));
    for (const id of ids) if (on) pinned.add(id); else pinned.delete(id);
    syncHighlight();
  }
  function unpinAll() { pinned.clear(); syncHighlight(); }
  function syncHighlight(redraw = true) {
    for (const el of document.querySelectorAll('[data-shot]')) {
      el.classList.toggle('hl', el.dataset.shot === hover);
      el.classList.toggle('pinned', pinned.has(el.dataset.shot));
    }
    for (const el of document.querySelectorAll('#tbl tr[data-row]')) {
      const ids = rowIds(el);
      el.classList.toggle('hl', ids.includes(hover));
      el.classList.toggle('pinned', ids.some(id => pinned.has(id)));
    }
    if (redraw) { drawOverlay(); drawTrend(); }
    const r = hover && allRows().find(x => x.shot.id === hover);
    $('#status-hover').textContent = r ? `${r.batch.name} / ${r.shot.label}: I = ${U.formatSI(r.p.I, 'A', 3)} · ${metric(prefs.metric).label} ${fmtMetric(metric(prefs.metric), r.edge[prefs.metric])}` : '';
  }
  const emphasis = () => hover || pinned.size;
  const isHi = id => id === hover || pinned.has(id);

  // ---------------------------------------------------------------- overlay plot
  const ov = { sx: null, sy: null, A: null, rows: [] };
  /** Default time window around t50: covers the slowest visible edge and the ringing window. */
  function autoView(rows) {
    let rise = 0;
    for (const r of rows) if (r.edge.t10 !== null && r.edge.t90 !== null) rise = Math.max(rise, Math.abs(r.edge.t50 - r.edge.t10), Math.abs(r.edge.t90 - r.edge.t50));
    rise = rise || 10e-9;
    return { a: -Math.max(3 * rise, 10e-9), b: Math.max(pool.settings.ringWindow * 1.5, 4 * rise) };
  }
  function drawOverlay() {
    const cv = $('#cv-overlay'), { ctx, w, h } = P.fit(cv);
    ctx.fillStyle = P.INK.bg; ctx.fillRect(0, 0, w, h);
    const rows = visRows().filter(r => r.edge.t50 !== undefined && swCol(r));
    ov.rows = rows;
    if (!rows.length) { ov.sx = null; noData(ctx, w, h, pool.shots.length ? 'No shot with this edge is shown' : ''); return; }
    const view = prefs.view || autoView(rows);
    // y range over the visible window
    let lo = Infinity, hi = -Infinity;
    for (const r of rows) {
      const c = swCol(r), i0 = Math.max(0, Math.floor((view.a + r.edge.t50 - c.t0) / c.dt)), i1 = Math.min(c.v.length - 1, Math.ceil((view.b + r.edge.t50 - c.t0) / c.dt));
      for (let i = i0; i <= i1; i++) { const v = c.v[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const [y0, y1] = P.extent([lo, hi], 0.05);
    const A = P.area(w, h), sx = P.scale(view.a, view.b, A.x, A.x + A.w), sy = P.scale(y0, y1, A.y + A.h, A.y);
    Object.assign(ov, { sx, sy, A });
    P.axes(ctx, A, sx, sy, { xUnit: 's', yUnit: 'V', xTitle: 't − t50', yTitle: 'Switch node' });
    P.clip(ctx, A);
    const col = colorizer(), em = emphasis();
    const draw = (r, width, alpha, color) => {
      const c = swCol(r), t50 = r.edge.t50;
      ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.strokeStyle = color || col.of(r);
      App.series.strokeColumn(ctx, c, (view.a + t50 - c.t0) / c.dt, (view.b + t50 - c.t0) / c.dt,
        i => sx(c.t0 + i * c.dt - t50), v => sy(v), A.w);
    };
    ctx.lineJoin = 'round';
    for (const r of rows) if (!isHi(r.shot.id)) draw(r, 1.25, em ? 0.25 : 0.9);
    // highlighted edges in a fixed green: the blue gradient gives them too little contrast
    for (const r of rows) if (isHi(r.shot.id)) draw(r, 2.5, 1, P.INK.hl);
    ctx.globalAlpha = 1;
    // level marks of the hovered edge: 10 / 90 % crossings and the settled levels
    const hr = rows.find(r => r.shot.id === hover) || (pinned.size === 1 && rows.find(r => pinned.has(r.shot.id)));
    if (hr) {
      const e = hr.edge;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = P.INK.fg2; ctx.lineWidth = 1; ctx.beginPath();
      for (const L of [e.base, e.top]) { ctx.moveTo(A.x, sy(L)); ctx.lineTo(A.x + A.w, sy(L)); }
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = P.INK.fg;
      for (const [t, p] of [[e.t10, 0.1], [e.t90, 0.9]]) if (t !== null) { P.marker(ctx, 'circle', sx(t - e.t50), sy(e.base + p * e.swing), 3.5); ctx.fill(); }
    }
    ctx.restore();
    legend(ctx, A, col);
  }
  function noData(ctx, w, h, msg) {
    ctx.save();
    ctx.fillStyle = P.INK.fg2; ctx.font = '13px system-ui, "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(msg, w / 2, h / 2);
    ctx.restore();
  }
  /** Legend background: a panel slightly lighter than the plot, so it reads over the curves. */
  function legendBox(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(22,26,32,.92)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = P.INK.axis; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  function legend(ctx, A, col) {
    ctx.save();
    ctx.font = '11px system-ui, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const x = A.x + 10, y = A.y + 12;
    if (col.kind === 'seq') {
      const wBar = 140;
      const g = ctx.createLinearGradient(x, 0, x + wBar, 0);
      P.SEQ.forEach((c, k) => g.addColorStop(k / (P.SEQ.length - 1), c));
      legendBox(ctx, x - 6, y - 9, wBar + 12, 48);
      ctx.fillStyle = P.INK.fg; ctx.fillText(col.info.label + (col.log ? ' · log scale' : ''), x, y);
      ctx.fillStyle = g; ctx.fillRect(x, y + 10, wBar, 8);
      ctx.fillStyle = P.INK.fg2;
      ctx.fillText(fmtParam(col.info.key, col.lo), x, y + 28);
      ctx.textAlign = 'right'; ctx.fillText(fmtParam(col.info.key, col.hi), x + wBar, y + 28);
    } else {
      const items = col.cats.slice(0, 8);
      const wMax = Math.max(...items.map(c => ctx.measureText(c).width)) + 22;
      legendBox(ctx, x - 6, y - 9, wMax + 12, items.length * 16 + 4);
      items.forEach((c, k) => {
        ctx.fillStyle = P.CATEGORICAL[k]; ctx.fillRect(x, y + k * 16 - 1, 12, 3);
        ctx.fillStyle = P.INK.fg; ctx.fillText(c, x + 18, y + k * 16);
      });
    }
    ctx.restore();
  }
  function overlayHit(mx, my) {
    if (!ov.sx) return null;
    const t = ov.sx.inv(mx);
    let best = null, bd = 12;
    for (const r of ov.rows) {
      const c = swCol(r), x = (t + r.edge.t50 - c.t0) / c.dt;
      if (x < 0 || x > c.v.length - 1) continue;
      const i = Math.floor(x), v = c.v[i] + (c.v[Math.min(i + 1, c.v.length - 1)] - c.v[i]) * (x - i);
      const d = Math.abs(ov.sy(v) - my);
      if (d < bd) { bd = d; best = { r, v, t }; }
    }
    return best;
  }
  function zoomOverlay(factor, tAt) {
    const v = prefs.view || autoView(ov.rows);
    if (tAt === undefined) tAt = (v.a + v.b) / 2;
    prefs.view = { a: tAt + (v.a - tAt) * factor, b: tAt + (v.b - tAt) * factor };
    drawOverlay(); savePrefsSoon();
  }
  function panOverlay(frac) {
    const v = prefs.view || autoView(ov.rows), d = (v.b - v.a) * frac;
    prefs.view = { a: v.a + d, b: v.b + d }; drawOverlay(); savePrefsSoon();
  }
  const savePrefsSoon = U.debounce(savePrefs, 400);
  function initOverlayEvents() {
    const cv = $('#cv-overlay'), tip = $('#tip-overlay');
    let drag = null;
    cv.addEventListener('wheel', e => {
      if (!ov.sx) return;
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (e.shiftKey) panOverlay(Math.sign(e.deltaY) * 0.1);
      else zoomOverlay(e.deltaY > 0 ? 1.25 : 0.8, ov.sx.inv(e.clientX - r.left));
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (!ov.sx || e.button !== 0) return;   // right button: context menu, no pin
      cv.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, view: prefs.view || autoView(ov.rows), moved: false };
    });
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) {
        if (Math.abs(e.clientX - drag.x) > 3) { drag.moved = true; cv.classList.add('dragging'); }
        if (drag.moved) {
          const dt = ov.sx.inv(drag.x - r.left) - ov.sx.inv(e.clientX - r.left);
          prefs.view = { a: drag.view.a + dt, b: drag.view.b + dt }; drawOverlay();
        }
        return;
      }
      const hit = overlayHit(mx, my);
      setHover(hit ? hit.r.shot.id : null);
      if (hit) showTip(tip, mx, my, cv, `<b>${esc(hit.r.batch.name)} / ${esc(hit.r.shot.label)}</b><br>I = ${U.formatSI(hit.r.p.I, 'A', 3)}` +
        (prefs.color !== 'I' && prefs.color !== 'Folder' ? ` · ${esc(prefs.color)} = ${esc(fmtParam(prefs.color, hit.r.p[prefs.color]))}` : '') +
        `<br>t − t50 = ${U.formatSI(hit.t, 's', 3)} · ${U.formatSI(hit.v, 'V', 3)}`);
      else tip.style.display = 'none';
    });
    const end = e => {
      if (!drag) return;
      const wasMoved = drag.moved; drag = null; cv.classList.remove('dragging');
      if (wasMoved) savePrefs();
      else { const r = cv.getBoundingClientRect(), hit = overlayHit(e.clientX - r.left, e.clientY - r.top); if (hit) togglePin(hit.r.shot.id); }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', () => { drag = null; cv.classList.remove('dragging'); });
    cv.addEventListener('pointerleave', () => { if (!drag) { tip.style.display = 'none'; setHover(null); } });
    cv.addEventListener('dblclick', () => fitOverlay());
  }
  function fitOverlay() { prefs.view = null; savePrefs(); drawOverlay(); }
  function showTip(tip, mx, my, cv, html) {
    tip.innerHTML = html; tip.style.display = 'block';
    const W = cv.clientWidth, tw = tip.offsetWidth;
    tip.style.left = (mx + 14 + tw > W ? mx - 14 - tw : mx + 14) + 'px';
    tip.style.top = Math.max(4, my - 10 - tip.offsetHeight) + 'px';
  }

  // ---------------------------------------------------------------- trend plot
  const tr = { pts: [] };
  /** Rate metrics: V/s -> V/ms | V/µs | V/ns so the axis reads in familiar units. */
  function rateUnit(maxAbs) {
    for (const [mult, u] of [[1e-9, 'V/ns'], [1e-6, 'V/µs'], [1e-3, 'V/ms']]) if (maxAbs * mult >= 0.5) return { mult, u };
    return { mult: 1, u: 'V/s' };
  }
  /** Group label of a row, e.g. 'SC = 0 · RHR = 100'; cats in order of first appearance. */
  const groupLabel = r => prefs.groups.map(g => `${g} = ${fmtParam(g, r.p[g])}`).join(' · ');
  function groupInfo() {
    const cats = [];
    if (!prefs.groups.length) return { of: () => 0, cats: [''] };
    for (const r of allRows()) { const v = groupLabel(r); if (!cats.includes(v)) cats.push(v); }
    return { of: r => cats.indexOf(groupLabel(r)), cats };
  }
  /**
   * Trend points. With prefs.repeats on, shots with the same shot name, folder parameters and group
   * (e.g. one setup measured three times in separate folders) merge into one point at the mean of x
   * and y; xe / ye are the error bar ends (± sample σ or min–max). Each point keeps its member rows.
   */
  function trendPoints(rows, xk, yOf, gi) {
    const keys = pool.paramKeys().filter(k => !k.builtin).map(k => k.key), sets = new Map();
    for (const r of rows) {
      const id = prefs.repeats === 'off' ? r.shot.id : JSON.stringify([gi.of(r), r.shot.label, ...keys.map(k => r.p[k])]);
      if (!sets.has(id)) sets.set(id, []);
      sets.get(id).push(r);
    }
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const bar = a => {
      if (a.length < 2) return null;
      if (prefs.repeats === 'range') return [Math.min(...a), Math.max(...a)];
      const mu = mean(a), sd = Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length - 1));
      return [mu - sd, mu + sd];
    };
    return [...sets.values()].map(list => {
      const xs = list.map(r => r.p[xk]), ys = list.map(yOf);
      return { rows: list, g: gi.of(list[0]), x: mean(xs), y: mean(ys), xs, ys, xe: bar(xs), ye: bar(ys) };
    });
  }
  function drawTrend() {
    const cv = $('#cv-trend'), { ctx, w, h } = P.fit(cv);
    ctx.fillStyle = P.INK.bg; ctx.fillRect(0, 0, w, h);
    const m = metric(prefs.metric), xk = prefs.x, xi = keyInfo(xk);
    const rows = visRows().filter(r => isFinite(r.p[xk]) && r.p[xk] !== null && isFinite(r.edge[m.key]) && r.edge[m.key] !== null);
    tr.pts = [];
    if (!rows.length || !xi) { noData(ctx, w, h, pool.shots.length ? 'No values for this metric' : ''); return; }
    const logX = prefs.logX && rows.every(r => r.p[xk] > 0);
    const ru = m.rate ? rateUnit(Math.max(...rows.map(r => Math.abs(r.edge[m.key])))) : null;
    const yOf = r => r.edge[m.key] * (ru ? ru.mult : 1);
    const gi = groupInfo(), em = emphasis(), pts = trendPoints(rows, xk, yOf, gi);
    const ys = [...pts.map(p => p.y), ...pts.flatMap(p => p.ye || [])], xs = [...pts.map(p => p.x), ...pts.flatMap(p => p.xe || [])].filter(v => !logX || v > 0);
    let [y0, y1] = P.extent(ys, 0.08);
    if (m.zero) { y0 = Math.min(0, y0); }
    const A = P.area(w, h);
    let sx;
    if (logX) {
      const lx = xs.map(Math.log10), [a, b] = P.extent(lx, 0.04);
      sx = P.logScale(Math.pow(10, a), Math.pow(10, b), A.x, A.x + A.w);
    } else { const [a, b] = P.extent(xs, 0.04); sx = P.scale(a, b, A.x, A.x + A.w); }
    const sy = P.scale(y0, y1, A.y + A.h, A.y);
    P.axes(ctx, A, sx, sy, { xUnit: xi.unit, yUnit: ru ? '' : m.unit === '%' ? '' : m.unit, xTitle: xi.label, yTitle: `${m.label} · ${EDGE_LABEL(prefs.edge).toLowerCase()}${ru ? ` (${ru.u})` : m.unit === '%' ? ' (%)' : ''}` });
    P.clip(ctx, A);
    const groups = new Map();
    for (const p of pts) { if (!groups.has(p.g)) groups.set(p.g, []); groups.get(p.g).push(p); }
    for (const [g, list] of groups) {
      list.sort((a, b) => a.x - b.x);
      const color = P.CATEGORICAL[g] || P.INK.fg2, shape = P.MARKERS[g] || 'circle';
      ctx.globalAlpha = em ? 0.45 : 1;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
      list.forEach((p, k) => { const X = sx(p.x), Y = sy(p.y); if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke();
      for (const p of list) {
        const X = sx(p.x), Y = sy(p.y), hi = p.rows.some(r => isHi(r.shot.id));
        ctx.globalAlpha = em && !hi ? 0.45 : 1;
        if (p.rows.length > 1) {
          // single measurements as small dots behind the error bars (y only: their x spread is the horizontal bar)
          ctx.fillStyle = color;
          for (const v of p.ys) { ctx.beginPath(); ctx.arc(X, sy(v), 1.8, 0, Math.PI * 2); ctx.fill(); }
          ctx.strokeStyle = hi ? P.INK.fg : color; ctx.lineWidth = 1.5; ctx.beginPath();
          if (p.ye) { const a = sy(p.ye[0]), b = sy(p.ye[1]); ctx.moveTo(X, a); ctx.lineTo(X, b); ctx.moveTo(X - 4, a); ctx.lineTo(X + 4, a); ctx.moveTo(X - 4, b); ctx.lineTo(X + 4, b); }
          if (p.xe && (!logX || p.xe[0] > 0)) { const a = sx(p.xe[0]), b = sx(p.xe[1]); ctx.moveTo(a, Y); ctx.lineTo(b, Y); ctx.moveTo(a, Y - 3); ctx.lineTo(a, Y + 3); ctx.moveTo(b, Y - 3); ctx.lineTo(b, Y + 3); }
          ctx.stroke();
        }
        P.marker(ctx, shape, X, Y, hi ? 6 : 4);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = hi ? P.INK.fg : P.INK.bg; ctx.stroke();
        if (p.rows.some(r => r.edge.warn.length || r.shot.res.warn.length)) { ctx.fillStyle = '#fbbf24'; ctx.fillRect(X + 4, Y - 9, 3, 3); }
        tr.pts.push({ r: p.rows[0], rows: p.rows, pt: p, X, Y, y: p.y });
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (prefs.groups.length && gi.cats.length > 1) {
      ctx.save(); ctx.font = '11px system-ui, "Segoe UI", sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const items = gi.cats.slice(0, 8), more = gi.cats.length - items.length;
      if (more) items.push(`+ ${more} more (grey)`);
      const wMax = Math.max(...items.map(c => ctx.measureText(c).width)) + 24;
      const x = A.x + A.w - wMax - 10, y = A.y + 12;
      legendBox(ctx, x - 6, y - 9, wMax + 12, items.length * 16 + 4);
      items.forEach((c, k) => {
        P.marker(ctx, P.MARKERS[k] || 'circle', x + 6, y + k * 16, 4); ctx.fillStyle = P.CATEGORICAL[k] || P.INK.fg2; ctx.fill();
        ctx.fillStyle = P.INK.fg; ctx.fillText(c, x + 16, y + k * 16);
      });
      ctx.restore();
    }
    tr.unit = ru ? ru.u : m.unit; tr.mult = ru ? ru.mult : 1;
  }
  function trendHit(mx, my) {
    let best = null, bd = 14;
    for (const p of tr.pts) { const d = Math.hypot(p.X - mx, p.Y - my); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  function initTrendEvents() {
    const cv = $('#cv-trend'), tip = $('#tip-trend');
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, hit = trendHit(mx, my);
      setHover(hit ? hit.r.shot.id : null);
      if (!hit) { tip.style.display = 'none'; return; }
      const m = metric(prefs.metric), warn = hit.rows.flatMap(r => [...r.shot.res.warn, ...r.edge.warn]);
      if (hit.rows.length > 1) {
        // p.y / ys / ye are in plot units (rate metrics scaled by tr.mult); fmtMetric wants SI
        const p = hit.pt, fy = v => esc(fmtMetric(m, v / tr.mult)), spread = prefs.repeats === 'range' ? 'min–max' : '± σ';
        showTip(tip, mx, my, cv, `<b>${hit.rows.length} repeats of ${esc(hit.r.shot.label)}</b> (${hit.rows.map(r => esc(r.batch.name)).join(', ')})<br>` +
          `${esc(keyInfo(prefs.x).label)} = ${esc(fmtParam(prefs.x, p.x))} (${p.xs.map(v => esc(fmtParam(prefs.x, v))).join(', ')})<br>` +
          `${esc(m.label)} = ${fy(p.y)}, ${spread}: ${fy(p.ye[0])} … ${fy(p.ye[1])}<br>` +
          `<span class="muted">single: ${p.ys.map(fy).join(', ')}</span>` +
          (warn.length ? `<br><span style="color:var(--warn)">! ${esc(warn.join('; '))}</span>` : ''));
        return;
      }
      showTip(tip, mx, my, cv, `<b>${esc(hit.r.batch.name)} / ${esc(hit.r.shot.label)}</b><br>` +
        `${esc(keyInfo(prefs.x).label)} = ${esc(fmtParam(prefs.x, hit.r.p[prefs.x]))}<br>${esc(m.label)} = ${esc(fmtMetric(m, hit.r.edge[m.key]))}` +
        (prefs.groups.length ? `<br>${esc(groupLabel(hit.r))}` : '') +
        (warn.length ? `<br><span style="color:var(--warn)">! ${esc(warn.join('; '))}</span>` : ''));
    });
    cv.addEventListener('pointerleave', () => { tip.style.display = 'none'; setHover(null); });
    cv.addEventListener('click', e => { const b = cv.getBoundingClientRect(), hit = trendHit(e.clientX - b.left, e.clientY - b.top); if (!hit) return;
      togglePins(hit.rows.map(r => r.shot.id));   // a repeat point pins / unpins all its shots together
    });
    // the two clicks before it pin and unpin again, so double-click leaves the pins as they were
    cv.addEventListener('dblclick', e => { const b = cv.getBoundingClientRect(), hit = trendHit(e.clientX - b.left, e.clientY - b.top); if (hit) revealShot(hit.r.shot.id); });
  }

  // ---------------------------------------------------------------- table
  /** Table columns. spread: measured value, shown as mean ± σ in a collapsed entry; entry: value of the whole entry. */
  function columns() {
    const params = pool.paramKeys().filter(k => !k.builtin);
    return [
      { key: 'folder', label: 'Folder', txt: true, get: r => r.batch.name },
      { key: 'shot', label: 'Shot', txt: true, get: r => r.shot.label },
      ...(prefs.collapse ? [{ key: 'runs', label: 'Runs', entry: e => e.rows.length }] : []),
      ...params.map(k => ({ key: 'p:' + k.key, label: k.key, txt: !k.numeric, unit: k.unit, get: r => r.p[k.key], fmt: v => fmtParam(k.key, v) })),
      { key: 'I', label: 'I', unit: 'A', spread: true, get: r => r.p.I, fmt: v => U.formatSI(v, 'A', 3) },
      ...METRICS.map(m => ({ key: m.key, label: m.label.replace(' (1st oscillation)', '').replace(' (% of swing)', ' %'), unit: m.unit, spread: true, get: r => r.edge[m.key], fmt: v => fmtMetric(m, v) })),
      { key: 'warn', label: 'Notes', txt: true, get: r => [...r.shot.res.warn, ...r.edge.warn].join('; ') },
    ];
  }
  /**
   * Table entries { rows, r (first row), off }. With prefs.collapse, shots with the same shot name and folder
   * parameters (repeats, as in the trend plot but regardless of Group by) form one entry; its hidden shots
   * only count when all of them are hidden.
   */
  function tableEntries() {
    const rows = shownRows();
    if (!prefs.collapse) return rows.map(r => ({ rows: [r], r, off: r.shot.hidden }));
    const keys = pool.paramKeys().filter(k => !k.builtin).map(k => k.key), sets = new Map();
    for (const r of rows) {
      const id = JSON.stringify([r.shot.label, ...keys.map(k => r.p[k])]);
      if (!sets.has(id)) sets.set(id, []);
      sets.get(id).push(r);
    }
    return [...sets.values()].map(all => {
      const on = all.filter(r => !r.shot.hidden), list = on.length ? on : all;
      return { rows: list, r: list[0], off: !on.length };
    });
  }
  /** Value of a column for an entry: { v } or, for a spread column over several shots, { v: mean, sd: sample σ, n }. */
  function cellOf(c, e) {
    if (c.entry) return { v: c.entry(e) };
    if (e.rows.length === 1) return { v: c.get(e.r) };
    const vals = e.rows.map(c.get);
    if (!c.spread) {
      const set = [...new Set(vals.map(v => v ?? ''))].filter(v => v !== '');
      return { v: set.length === 1 ? set[0] : set.join(c.key === 'warn' ? '; ' : ', '), all: set };
    }
    const xs = vals.filter(v => typeof v === 'number' && isFinite(v));
    if (!xs.length) return { v: null };
    const mu = xs.reduce((s, v) => s + v, 0) / xs.length;
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - mu) ** 2, 0) / (xs.length - 1)) : null;
    return { v: mu, sd, n: xs.length };
  }
  /** "16.6 ± 0.12 V/ns": σ to 2 digits in the same unit prefix as the mean. */
  function fmtCell(c, x) {
    const s = c.fmt ? c.fmt(x.v) : String(x.v ?? '');
    if (x.sd === null || x.sd === undefined) return s;
    const m = /^(-?[\d.]+(?:e[-+]?\d+)?)\s*(.*)$/.exec(s), scale = m && Number(m[1]) / x.v;
    if (!m || !isFinite(scale) || !scale) return `${s} ± ${c.fmt(x.sd)}`;
    return `${m[1]} ± ${Number((x.sd * scale).toPrecision(2))}${m[2] ? ' ' + m[2] : ''}`;
  }
  function sortedEntries() {
    const ents = tableEntries(), s = prefs.sort;
    if (!s) return ents;
    const c = columns().find(x => x.key === s.key);
    if (!c) return ents;
    const val = e => cellOf(c, e).v;
    return ents.map(e => [e, val(e)]).sort(([, x], [, y]) => {
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : U.naturalCompare(String(x ?? ''), String(y ?? ''));
      return s.desc ? -d : d;
    }).map(([e]) => e);
  }
  const rowIds = tr => (tr.dataset.ids || tr.dataset.row).split(' ');
  function renderTable() {
    const cols = columns(), ents = sortedEntries(), s = prefs.sort;
    const total = allRows().length, n = ents.reduce((k, e) => k + e.rows.length, 0);
    const shots = `${n < total ? `${n} of ${total}` : n} shots`;
    $('#tbl-title').textContent = !prefs.edge ? 'Edges' : `${EDGE_LABEL(prefs.edge)} · ${prefs.collapse ? `${ents.length} entries from ${shots}` : shots}`;
    $('#tgl-collapse').checked = prefs.collapse;
    $('#tbl').className = 'grid-table';
    $('#tbl').innerHTML = `<thead><tr>${cols.map(c => `<th data-col="${esc(c.key)}" class="${c.txt ? 'txt' : ''}${s && s.key === c.key ? ' sorted' + (s.desc ? ' desc' : '') : ''}" title="Sort">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${ents.map(e => `<tr data-row="${e.r.shot.id}"${e.rows.length > 1 ? ` data-ids="${e.rows.map(r => r.shot.id).join(' ')}"` : ''} class="${e.off ? 'off' : ''}">${cols.map(c => {
        const x = cellOf(c, e);
        // several folders: the first one + count, all of them in the tooltip
        if (x.all && c.key === 'folder' && x.all.length > 1) return `<td class="txt" title="${esc(x.v)}">${esc(x.all[0])} +${x.all.length - 1}</td>`;
        return `<td class="${c.txt ? 'txt' : ''}"${x.sd !== undefined ? ` title="mean ± σ of ${x.n} shot(s)"` : ''}>${esc(fmtCell(c, x))}</td>`;
      }).join('')}</tr>`).join('')}</tbody>`;
    syncHighlight(false);
  }
  function initTableEvents() {
    const t = $('#tbl');
    t.addEventListener('click', e => {
      const th = e.target.closest('th');
      if (th) {
        const k = th.dataset.col, s = prefs.sort;
        prefs.sort = !s || s.key !== k ? { key: k, desc: false } : s.desc ? null : { key: k, desc: true };
        savePrefs(); renderTable(); return;
      }
      const tr = e.target.closest('tr[data-row]');
      if (tr) togglePins(rowIds(tr));
    });
    t.addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-row]'); setHover(tr ? tr.dataset.row : null); });
    t.addEventListener('mouseleave', () => setHover(null));
    $('#tgl-collapse').addEventListener('change', e => { prefs.collapse = e.target.checked; savePrefs(); renderTable(); });
  }
  /**
   * Table as text. sep '\t' = formatted for pasting, ',' = CSV with plain SI numbers and units in the header.
   * Collapsed entries: mean ± σ in one cell, in CSV the mean plus a σ column after each measured column.
   */
  function tableText(sep) {
    const cols = columns(), ents = sortedEntries().filter(e => !e.off), sd = sep === ',' && prefs.collapse;
    const cell = s => { s = String(s ?? ''); return sep === ',' && /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/\t/g, ' '); };
    const num = v => typeof v === 'number' ? (isFinite(v) ? String(v) : '') : v;
    const head = cols.flatMap(c => {
      const h = [cell(sep === ',' && c.unit ? `${c.label} [${c.unit}]` : c.label)];
      if (sd && c.spread) h.push(cell(`${c.label} σ${c.unit ? ` [${c.unit}]` : ''}`));
      return h;
    }).join(sep);
    const body = ents.map(e => cols.flatMap(c => {
      const x = cellOf(c, e);
      if (sep !== ',') return [cell(fmtCell(c, x))];
      return sd && c.spread ? [cell(num(x.v)), cell(num(x.sd ?? ''))] : [cell(num(x.v))];
    }).join(sep));
    return [head, ...body].join('\n');
  }

  // ---------------------------------------------------------------- batch dialog
  /**
   * Add mode: { draft } from App.dpt.pool.draft (resolves true when added).
   * Edit mode: { batchId }. Resolves when the dialog closes.
   */
  function openBatchDialog({ draft, batchId }) {
    const dlg = $('#batch-dlg');
    const edit = !draft, b0 = edit ? pool.batches.find(b => b.id === batchId) : draft.batch;
    const shots = edit ? pool.shots.filter(s => s.batchId === batchId) : draft.shots;
    const roles = Object.assign({}, b0.roles);
    const channels = [...new Set(shots.flatMap(s => Object.keys(s.cols || {})))].sort();
    let params = b0.params.map(p => ({ key: p.key, text: p.value !== null && p.unit && !/[A-Za-zΩ]$/.test(p.text) ? `${p.text} ${p.unit}` : p.text }));
    const over = new Map(shots.map(s => [s.id, s.current]));
    $('#bd-title').textContent = edit ? `Edit folder` : `Add folder`;
    $('#bd-name').value = b0.name;
    $('[data-bd="ok"]').textContent = edit ? 'Save' : 'Add to pool';
    const chOpts = (sel, val, none) => { sel.innerHTML = (none ? '<option value="">none</option>' : '') + channels.map(c => `<option${c === val ? ' selected' : ''}>${c}</option>`).join(''); };
    chOpts($('#bd-sw'), roles.sw, false); chOpts($('#bd-cur'), roles.cur, true);

    const renderParams = () => {
      $('#bd-params').innerHTML = '<tr><th class="muted">Name</th><th class="muted">Value (with unit, e.g. 10 Ω, 24 V, 1M)</th><th></th></tr>' + params.map((p, k) =>
        `<tr data-k="${k}"><td><input data-f="key" value="${esc(p.key)}" placeholder="Rg"></td><td><input data-f="text" value="${esc(p.text)}" placeholder="10 Ω"></td>
        <td><button class="small danger" data-bd="del-param" title="Remove">×</button></td></tr>`).join('');
    };
    const renderShots = () => {
      const items = [];
      $('#bd-count').textContent = `(${shots.length})`;
      $('#bd-shots').innerHTML = `<thead><tr><th>Shot</th><th>Files</th><th>I (mean of ${esc(roles.cur || '–')})</th><th title="Overrides the measured current for this shot">I override</th><th>Edges found</th><th>Notes</th></tr></thead><tbody>` +
        shots.map(s => {
          const sw = s.cols[roles.sw], cur = roles.cur ? s.cols[roles.cur] || null : null;
          const res = sw ? App.dpt.edges.analyze(sw, cur, pool.settings) : { edges: [], iMean: null, warn: [`no channel ${roles.sw}`] };
          items.push({ label: s.label, sw, cur, res });
          const ov = over.get(s.id);
          const edges = res.edges.map(e => `${e.kind === 'rise' ? '↑' : '↓'} ${U.formatRate(e.slew1090)}`).join(' · ');
          const notes = [...(s.notes || []), ...res.warn, ...res.edges.flatMap(e => e.warn)];
          return `<tr data-s="${s.id}"><td>${esc(s.label)}</td><td class="muted">${esc(s.files.map(f => f.name).join(', '))}</td>
            <td>${U.formatSI(res.iMean, 'A', 3)}</td><td><input data-f="over" value="${ov !== null && ov !== undefined ? esc(U.formatSI(ov, 'A', 4)) : ''}" placeholder="auto"></td>
            <td>${edges || '<span class="muted">none</span>'}</td><td>${notes.length ? `<span class="badge warn">!</span> ${esc(notes.join('; '))}` : ''}</td></tr>`;
        }).join('') + '</tbody>';
      // import checks against the rest of the pool: sample rate, clipping
      const warn = pool.addWarnings(items, new Set([b0.id]));
      $('#bd-warn').hidden = !warn.length;
      $('#bd-warn').innerHTML = warn.map(w => `<div><span class="badge warn">!</span> ${esc(w)}</div>`).join('');
    };
    renderParams(); renderShots();

    return new Promise(resolve => {
      const onInput = e => {
        const tr = e.target.closest('tr');
        if (e.target.dataset.f === 'key' || e.target.dataset.f === 'text') params[+tr.dataset.k][e.target.dataset.f] = e.target.value;
        if (e.target.dataset.f === 'over') {
          const t = e.target.value.trim(), p = t ? U.parseSI(t, 'A') : null;
          e.target.classList.toggle('invalid', !!t && !p);
          over.set(tr.dataset.s, p ? p.value : null);
        }
      };
      const onChange = e => {
        if (e.target.id === 'bd-sw' || e.target.id === 'bd-cur') { roles.sw = $('#bd-sw').value; roles.cur = $('#bd-cur').value; renderShots(); }
      };
      const onClick = e => {
        const a = e.target.dataset.bd;
        if (a === 'add-param') { params.push({ key: '', text: '' }); renderParams(); dlg.querySelector('#bd-params tr:last-child input').focus(); }
        else if (a === 'del-param') { params.splice(+e.target.closest('tr').dataset.k, 1); renderParams(); }
        else if (a === 'cancel') close(false);
        else if (a === 'ok') commit();
      };
      const close = ok => {
        dlg.removeEventListener('input', onInput); dlg.removeEventListener('change', onChange); dlg.removeEventListener('click', onClick);
        dlg.removeEventListener('cancel', onCancel);
        dlg.close(); resolve(ok);
      };
      const onCancel = e => { e.preventDefault(); close(false); };
      async function commit() {
        const name = $('#bd-name').value.trim() || b0.name;
        const ps = params.filter(p => p.key.trim()).map(p => pool.param(p.key, p.text));
        // parameters no other folder has yet (in edit mode: and this folder did not have before)
        const others = pool.batches.filter(b => b.id !== b0.id);
        const fresh = others.length ? ps.filter(p => !others.some(b => b.params.some(q => q.key === p.key)) &&
          !(edit && b0.params.some(q => q.key === p.key))) : [];
        if (edit) {
          await pool.updateBatch(b0.id, { name, params: ps, roles: Object.assign({}, roles) });
          for (const s of shots) if (over.get(s.id) !== s.current) await pool.updateShots(s.id, { current: over.get(s.id) });
        } else {
          Object.assign(draft.batch, { name, params: ps, roles: Object.assign({}, roles) });
          for (const s of shots) s.current = over.get(s.id);
          await pool.addDraft(draft);
        }
        if (fresh.length) {
          const vals = await askDefaults(fresh, others.length);
          for (const p of fresh) if (vals[p.key]) await pool.fillParam(p.key, vals[p.key], p.unit);
        }
        close(true);
      }
      dlg.addEventListener('input', onInput); dlg.addEventListener('change', onChange); dlg.addEventListener('click', onClick);
      dlg.addEventListener('cancel', onCancel);
      dlg.showModal();
      if (!edit) setTimeout(() => { const first = dlg.querySelector('#bd-params input[data-f="text"]') || $('#bd-name'); first.focus(); first.select && first.select(); }, 0);
    });
  }

  /**
   * Ask for the value that folders already in the pool get for parameters that are new.
   * Resolves { key: text } (empty text = leave those folders without it). Enter fills in, Esc skips.
   */
  function askDefaults(params, n) {
    const dlg = $('#newparam-dlg');
    $('#np-text').textContent = `${n} folder${n === 1 ? '' : 's'} already in the pool ${n === 1 ? 'has' : 'have'} no value for ` +
      `${params.length === 1 ? 'this parameter' : 'these parameters'}. Value for ${n === 1 ? 'it' : 'them'} (leave empty to skip):`;
    $('#np-params').innerHTML = params.map(p => `<tr><td>${esc(p.key)}</td><td><input data-key="${esc(p.key)}" placeholder="${esc(p.text)}"></td></tr>`).join('');
    return new Promise(resolve => {
      const done = ok => {
        dlg.removeEventListener('click', onClick); dlg.removeEventListener('keydown', onKey); dlg.removeEventListener('cancel', onCancel);
        const out = {};
        if (ok) for (const i of dlg.querySelectorAll('#np-params input')) out[i.dataset.key] = i.value.trim();
        dlg.close(); resolve(out);
      };
      const onClick = e => { if (e.target.dataset.np) done(e.target.dataset.np === 'ok'); };
      const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); done(true); } };
      const onCancel = e => { e.preventDefault(); done(false); };
      dlg.addEventListener('click', onClick); dlg.addEventListener('keydown', onKey); dlg.addEventListener('cancel', onCancel);
      dlg.showModal();
      dlg.querySelector('#np-params input').focus();
    });
  }

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    const s = pool.settings;
    $('#set-dvdt').value = U.formatSI(s.dvdtWindow, 's');
    $('#set-ring').value = U.formatSI(s.ringWindow, 's');
  }
  function initSettings() {
    const map = { '#set-dvdt': 'dvdtWindow', '#set-ring': 'ringWindow' };
    for (const [sel, key] of Object.entries(map)) {
      $(sel).addEventListener('change', e => {
        const p = U.parseSI(e.target.value, 's');
        e.target.classList.toggle('invalid', !p || !(p.value > 0));
        if (!p || !(p.value > 0)) return;
        const s = Object.assign({}, pool.settings, { [key]: p.value });
        prefs.settings = s; savePrefs();
        pool.setSettings(s);
      });
    }
  }

  // ---------------------------------------------------------------- context menu (right-click a shot in any view)
  /** Shot id under a mouse event: pool list entry, table row, overlay curve or trend point. */
  function shotAt(e) {
    const el = e.target.closest('[data-shot], tr[data-row]');
    if (el) return el.dataset.shot || el.dataset.row;
    const hitFn = e.target.id === 'cv-overlay' ? overlayHit : e.target.id === 'cv-trend' ? trendHit : null;
    if (!hitFn) return null;
    const r = e.target.getBoundingClientRect(), hit = hitFn(e.clientX - r.left, e.clientY - r.top);
    return hit ? hit.r.shot.id : null;
  }
  const CTX = {
    open: id => App.dpt.app.openInScope([id]),
    'open-pinned': () => App.dpt.app.openInScope([...pinned]),
    pin: id => togglePin(id),
    reveal: id => revealShot(id),
  };
  function openMenu(e) {
    const id = shotAt(e), sh = id && pool.shots.find(s => s.id === id);
    if (!sh) return;
    e.preventDefault();
    const m = $('#ctx-menu'), many = pinned.has(id) && pinned.size > 1;
    m.dataset.shot = id;
    m.innerHTML = `<div class="ctx-head">${esc(pool.batchOf(sh).name)} / ${esc(sh.label)}</div>
      <button data-ctx="open" title="Open this shot in the analyzer, zoomed to the selected edge (O)">Open in scope view</button>
      ${many ? `<button data-ctx="open-pinned">Open all ${pinned.size} pinned shots</button>` : ''}
      <button data-ctx="pin">${pinned.has(id) ? 'Unpin' : 'Pin'}</button>
      <button data-ctx="reveal" title="Scroll the folder list to this shot (double-click a trend point)">Show in folder list</button>`;
    m.style.display = 'block';
    m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 4) + 'px';
    m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 4) + 'px';
    m.querySelector('button').focus();
  }
  const closeMenu = () => { $('#ctx-menu').style.display = 'none'; };
  const menuOpen = () => $('#ctx-menu').style.display === 'block';
  function initMenu() {
    const m = $('#ctx-menu');
    document.addEventListener('contextmenu', e => { closeMenu(); openMenu(e); });
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-ctx]');
      if (!b) return;
      closeMenu(); CTX[b.dataset.ctx](m.dataset.shot);
    });
    document.addEventListener('pointerdown', e => { if (menuOpen() && !m.contains(e.target)) closeMenu(); }, true);
    window.addEventListener('keydown', e => { if (menuOpen() && e.key === 'Escape') { e.stopImmediatePropagation(); closeMenu(); } }, true);
    window.addEventListener('blur', closeMenu);
    document.addEventListener('scroll', closeMenu, true);
  }
  /** Shots the O key opens: the hovered one, else the pinned ones. */
  const keyShots = () => hover ? [hover] : [...pinned];
  /** Overlay time window relative to t50 (what the user is looking at). */
  const overlayWindow = () => prefs.view || autoView(ov.rows);

  // ---------------------------------------------------------------- toast / all
  let toastTimer = 0;
  function toast(msg, ms = 4000) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function renderAll() {
    document.body.classList.toggle('empty', !pool.shots.length);
    for (const id of [...pinned]) if (!pool.shots.some(s => s.id === id)) pinned.delete(id);
    renderSelects(); renderFilter(); renderPool(); renderTable(); renderSettings();
    drawOverlay(); drawTrend();
    const ws = pool.shots.filter(s => s.res && (s.res.warn.length || !s.res.edges.length)).length;
    $('#status').textContent = pool.shots.length ? `${pool.shots.length} shots in ${pool.batches.length} folder(s)${ws ? ` · ${ws} with warnings` : ''}` : 'Pool is empty';
  }

  function cycleEdge(dir) {
    const keys = pool.edgeKeys();
    if (!keys.length) return;
    prefs.edge = keys[(keys.indexOf(prefs.edge) + dir + keys.length) % keys.length];
    prefs.view = null; savePrefs(); renderAll();
  }

  function init() {
    if (prefs.settings) pool.setSettings(prefs.settings);
    onSelect('#sel-edge', 'edge');
    onSelect('#sel-color', 'color', () => { renderPool(); drawOverlay(); });
    onSelect('#sel-metric', 'metric', () => { drawTrend(); syncHighlight(false); });   // status line shows the metric
    onSelect('#sel-x', 'x', () => { renderSelects(); drawTrend(); });                 // group options exclude x
    initGroupSelects(); onSelect('#sel-repeats', 'repeats', drawTrend);
    $('#tgl-logx').addEventListener('click', () => { prefs.logX = !prefs.logX; savePrefs(); renderSelects(); drawTrend(); });
    initPoolEvents(); initOverlayEvents(); initTrendEvents(); initTableEvents(); initSettings(); initMenu(); initFilter();
    App.events.on('pool-changed', renderAll);
    App.events.on('toast', toast);
    new ResizeObserver(U.debounce(() => { drawOverlay(); drawTrend(); }, 50)).observe($('.plots'));
  }

  /** For tools/dpt_ui_test.ps1: hover / pin state and the trend points as drawn (CSS px in #cv-trend). */
  const debug = () => ({ hover, pinned: [...pinned], trend: tr.pts.map(p => ({ id: p.r.shot.id, X: p.X, Y: p.Y, y: p.y })), groups: groupInfo().cats });

  return { init, prefs, debug, renderAll, toast, openBatchDialog, tableText, fitOverlay, zoomOverlay, panOverlay, cycleEdge, unpinAll, togglePin, keyShots, overlayWindow, focusFilter, compileFilter, METRICS };
})();
