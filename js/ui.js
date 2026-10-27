// DOM panels around the canvas: thumbnail strip, cursor readout, calibration editor,
// status bar, toasts. Rendering is plain template strings; re-render on events.
App.ui = (() => {
  const { formatSI, formatRange, formatRate, parseSI, escapeHtml: esc } = App.util;
  const $ = sel => document.querySelector(sel);
  const prefs = { showOverlay: false, panelW: null, panelH: null };   // panelW/H: splitter positions (px), null = CSS default

  // ---------------------------------------------------------------- status badges
  const BADGE = { ok: ['✓', 'ok', 'Detected automatically, sources agree'], warn: ['!', 'warn', 'Uncertain — please check'], manual: ['✎', 'manual', 'Set manually'] };
  const badge = st => { const b = BADGE[st] || BADGE.warn; return `<span class="badge ${b[1]}" title="${b[2]}">${b[0]}</span>`; };

  function docHealth(d) {
    const all = [d.status.time.tdiv, d.status.time.tCenter];
    Object.entries(d.calib.channels).forEach(([id, c]) => { if (c.on) { const s = d.status.channels[id] || {}; all.push(s.vdiv, s.zeroY); } });
    if (!d.layoutId) return 'manual';
    if (all.includes('warn') || all.includes(undefined)) return 'warn';
    return all.includes('manual') ? 'manual' : 'ok';
  }

  // ---------------------------------------------------------------- thumbnail strip
  function renderStrip() {
    const docs = App.docs.list(), act = App.docs.active();
    $('#strip-count').textContent = docs.length ? `${docs.length} image${docs.length > 1 ? 's' : ''}` : '';
    $('#strip-list').innerHTML = docs.map((d, i) => `
      <li class="thumb ${act && act.id === d.id ? 'active' : ''}" data-id="${d.id}" title="${esc(d.name)}">
        <img src="${d.thumbUrl}" alt="" draggable="false">
        <div class="thumb-meta"><span class="thumb-idx">${i + 1}</span><span class="thumb-name" title="Double-click to rename (F2)">${esc(d.name)}</span>${badge(docHealth(d))}</div>
        <div class="thumb-btns">
          <button data-rename="${d.id}" title="Rename (F2)">✎</button>
          <button class="thumb-del" data-del="${d.id}" title="Remove from session">×</button>
        </div>
      </li>`).join('');
    const el = $('#strip-list .active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  /** Swap the name label of a thumbnail for a text field. Enter/blur saves, Esc cancels. */
  function startRename(id) {
    const d = App.docs.get(id || (App.docs.active() || {}).id);
    const span = d && $(`#strip-list .thumb[data-id="${d.id}"] .thumb-name`);
    if (!span) return;
    const inp = document.createElement('input');
    inp.className = 'thumb-rename'; inp.value = d.name; inp.spellcheck = false;
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      if (ok && inp.value.trim() && inp.value.trim() !== d.name) App.docs.rename(d.id, inp.value);
      else renderStrip();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('click', e => e.stopPropagation());
    inp.addEventListener('dblclick', e => e.stopPropagation());
    span.replaceWith(inp);
    inp.focus();
    const dot = d.name.lastIndexOf('.');
    inp.setSelectionRange(0, dot > 0 ? dot : d.name.length);
  }

  // ---------------------------------------------------------------- readout
  /** Colour-matched toggles next to the "Cursors" heading: which channels the cursors read. */
  function renderProbes(d) {
    const box = $('#probe-btns');
    if (!d) { box.innerHTML = ''; return; }
    const probed = App.measure.probedChannels(d);
    box.innerHTML = App.calib.CHANNELS.filter(ch => d.calib.channels[ch.id] && d.calib.channels[ch.id].on).map(ch =>
      `<button class="probe ${probed.includes(ch.id) ? 'on' : ''}" data-probe="${ch.id}" style="--c:${ch.color}" title="Read ${esc(App.calib.chLabel(d, ch.id))} at the cursors">${ch.id}</button>`).join('');
  }
  function toggleProbe(id) {
    const d = App.docs.active(); if (!d) return;
    const p = App.measure.probedChannels(d);
    d.cursors.probe = p.includes(id) ? p.filter(x => x !== id) : [...p, id];
    App.docs.touch(d, 'cursors');
  }

  /**
   * Results first: one block for time, one per probed channel. Each block = an input line
   * (values at cursor 1 -> cursor 2, with small cursor tags) followed by the results (Δ, slope / f),
   * each with its label directly above. Value bands go under the input line, amplitude under ΔV.
   */
  function renderReadout() {
    const d = App.docs.active(), box = $('#readout');
    $('#tgl-periods').classList.toggle('on', !!(d && d.cursors.periods));
    renderProbes(d);
    if (!d) { box.innerHTML = '<p class="muted">No image loaded.</p>'; return; }
    const ro = App.measure.cursorReadout(d);
    const C = App.view.CURSOR_COLORS;
    const sel = d.cursors.sel, P = ro.periods;
    const tag = k => `<button class="cur-tag mini ${sel === k ? 'sel' : ''}" data-cursor="${k}" style="--c:${C[k]}" title="Select cursor ${k} (for nudging with the arrow keys)">${k}</button>`;
    const input = (head, v1, v2) => `<div class="ro-in">${head}${tag(1)}<span>${v1}</span><span class="arr">→</span>${tag(2)}<span>${v2}</span></div>`;
    const res = (k, v, sub = '', title = '') => `<div${title ? ` title="${title}"` : ''}><div class="ro-k">${k}</div><div class="ro-v">${v}</div>${sub}</div>`;
    const sm = (html, title = '') => `<div class="ro-sm"${title ? ` title="${title}"` : ''}>${html}</div>`;
    const pv = x => x ? formatSI(x.v, x.unit, 4) : '<span class="muted">no trace</span>';
    const band = (x, unit) => x && x.vMax - x.vMin > 1e-12 ? formatRange(x.vMin, x.vMax, unit) : null;

    const freq = P
      ? res(`f over <span class="nstep"><button data-nstep="-1" title="One period less (,)">−</button><b>${P.n}</b><button data-nstep="1" title="One period more (.)">+</button></span> period${P.n > 1 ? 's' : ''}`,
          formatSI(P.freq, 'Hz', 5), sm(`T ${formatSI(P.period, 's', 5)}`), `Frequency measured over ${P.n} period${P.n > 1 ? 's' : ''}`)
      : res('1/Δt', formatSI(ro.freq, 'Hz'));
    let html = `<div class="ro-blk">${input('<span class="lbl">t</span>', formatSI(ro.t1, 's'), formatSI(ro.t2, 's'))}
      <div class="ro-main">${res('Δt (2−1)', formatSI(ro.dt, 's'), P ? sm(`1/Δt ${formatSI(ro.freq, 'Hz')}`) : '')}${freq}</div></div>`;

    ro.channels.forEach((c, i) => {
      const col = App.calib.channelById(c.id).color;
      const chip = `<span class="chip ${c.alt ? 'hollow' : ''}" style="--c:${col}" ${c.alt ? 'title="Second branch: the persistence display splits into two waveform populations here"' : ''}>${esc(App.calib.chLabel(d, c.id))}${c.alt ? ' ②' : ''}</span>`;
      const b1 = band(c.a, c.unit), b2 = band(c.b, c.unit);
      const bands = b1 || b2 ? sm(`band ${b1 || '–'} → ${b2 || '–'}`, 'Displayed band (trace thickness / sample block / persistence spread)') : '';
      const pc = P && P.channels[i];
      const sub = !pc ? '' : pc.amp !== null
        ? sm(`amp <b>${formatSI(pc.amp, c.unit, 4)}</b> · pk-pk ${formatSI(pc.pp, c.unit, 4)}`) +
          sm(`cycles ${formatRange(pc.ampMin, pc.ampMax, c.unit)}`, `Per cycle: ${pc.cycles.map(x => formatSI(x, c.unit, 3)).join(', ')} pk-pk`)
        : sm('amplitude: no trace');
      html += `<div class="ro-blk ch ${c.alt ? 'alt' : ''}" style="--c:${col}">${input(chip, pv(c.a && { ...c.a, unit: c.unit }), pv(c.b && { ...c.b, unit: c.unit }))}${bands}
        <div class="ro-main">${res('ΔV', formatSI(c.dv, c.unit), sub)}${res('ΔV/Δt', formatRate(c.slope, c.unit))}</div></div>`;
    });
    box.innerHTML = `<div class="readout">${html}</div>`;
  }

  function readoutTSV() {
    const d = App.docs.active(); if (!d) return '';
    const ro = App.measure.cursorReadout(d);
    const head = ['image', 't1 [s]', 't2 [s]', 'dt [s]', '1/dt [Hz]'], vals = [d.name, ro.t1, ro.t2, ro.dt, ro.freq];
    const P = ro.periods;
    if (P) { head.push('periods N', 'T [s]', 'N/dt [Hz]'); vals.push(P.n, P.period, P.freq); }
    ro.channels.forEach((c, i) => {
      const n = App.calib.chLabel(d, c.id) + (c.alt ? ' branch2' : '');
      head.push(`${n} v1 [${c.unit}]`, `${n} v2 [${c.unit}]`, `${n} dv [${c.unit}]`, `${n} dv/dt [${c.unit}/s]`);
      vals.push(c.v1, c.v2, c.dv, c.slope);
      if (P) { head.push(`${n} amplitude [${c.unit}]`, `${n} amp min [${c.unit}]`, `${n} amp max [${c.unit}]`); vals.push(P.channels[i].amp, P.channels[i].ampMin, P.channels[i].ampMax); }
    });
    const f = x => typeof x === 'number' ? (Number.isInteger(x) ? String(x) : isFinite(x) ? x.toPrecision(6) : '') : x === null ? '' : String(x);
    return head.join('\t') + '\n' + vals.map(f).join('\t');
  }

  // ---------------------------------------------------------------- calibration editor
  function renderCalib() {
    const d = App.docs.active(), box = $('#calib');
    $('#calib-title').textContent = d && d.kind === 'series' ? 'Display' : 'Calibration';
    if (!d) { box.innerHTML = ''; return; }
    if (d.kind === 'series') { box.innerHTML = seriesDisplayHtml(d); return; }
    const c = d.calib, st = d.status;
    const g = c.grid;
    let html = `
      <div class="layout-row"><span class="layout-name">${esc(d.layoutName || '')}</span>${badge(d.layoutId ? 'ok' : 'manual')}
        <button id="btn-redetect" class="small" title="Discard manual edits and run detection again">Re-detect</button></div>
      <div class="field"><label>Time / div</label><input data-k="tdiv" value="${esc(formatSI(c.time.tdiv, 's'))}">${badge(st.time.tdiv)}</div>
      <div class="field"><label>Time at centre</label><input data-k="tCenter" value="${esc(formatSI(c.time.tCenter, 's'))}">${badge(st.time.tCenter)}</div>
      <table class="ch-table"><tr><th>Ch</th><th>On</th><th>Scale / div</th><th>0 level (y px)</th></tr>`;
    for (const ch of App.calib.CHANNELS) {
      const cc = c.channels[ch.id], s = st.channels[ch.id] || {};
      html += `<tr class="${cc.on ? '' : 'off'}">
        <td><span class="chip" style="--c:${ch.color}">${ch.id}</span></td>
        <td><input type="checkbox" data-on="${ch.id}" ${cc.on ? 'checked' : ''}></td>
        <td><input data-vdiv="${ch.id}" value="${esc(formatSI(cc.vdiv, cc.unit || 'V'))}" ${cc.on ? '' : 'disabled'}>${cc.on ? badge(s.vdiv) : ''}</td>
        <td><span class="nowrap"><input data-zero="${ch.id}" class="num" value="${cc.zeroY.toFixed(1)}" ${cc.on ? '' : 'disabled'}><button class="icon" data-pickzero="${ch.id}" title="Click on the image to set the 0 level" ${cc.on ? '' : 'disabled'}>⌖</button>${cc.on ? badge(s.zeroY) : ''}</span></td></tr>`;
    }
    html += `</table>
      <details class="grid-box" ${d.layoutId ? '' : 'open'}><summary>Graticule ${badge(d.layoutId && st.grid !== 'manual' ? 'ok' : 'manual')}</summary>
        <div class="grid-fields">
          <label>left <input class="num" data-grid="left" value="${g.left}"></label>
          <label>right <input class="num" data-grid="right" value="${g.right}"></label>
          <label>top <input class="num" data-grid="top" value="${g.top}"></label>
          <label>bottom <input class="num" data-grid="bottom" value="${g.bottom}"></label>
          <label>h div <input class="num" data-grid="hdiv" value="${g.hdiv}"></label>
          <label>v div <input class="num" data-grid="vdiv" value="${g.vdiv}"></label>
        </div>
        <button id="btn-pickgrid" class="small">Pick grid on image…</button>
        <label class="inline"><input type="checkbox" id="chk-persist" ${c.persistence ? 'checked' : ''}> Persistence (colour-graded) display</label>
      </details>`;
    if (d.notes && d.notes.length) html += `<ul class="notes">${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
    if (d.raw && Object.keys(d.raw).length) html += `<details class="raw"><summary>Raw OCR</summary><pre>${esc(JSON.stringify(d.raw, null, 1))}</pre></details>`;
    box.innerHTML = html;
  }

  // Series (CSV) docs: the time axis comes from the file; the panel sets what is displayed:
  // visible window (time/div, centre) and per channel scale/div and the value at the grid centre.
  const centreOf = (c, id) => App.calib.vAt(c, id, (c.grid.top + c.grid.bottom) / 2);
  function seriesWindow(d) {
    const w = App.view.getWindow(d), s = d.series;
    return { tdiv: App.series.gridDiv((w.xb - w.xa) * s.dt), tCenter: App.calib.tAt(d.calib, (w.xa + w.xb) / 2) };
  }
  function seriesDisplayHtml(d) {
    const c = d.calib, w = seriesWindow(d);
    let html = `
      <div class="layout-row"><span class="layout-name one-line" title="CSV: ${d.series.n.toLocaleString('en')} samples, ${esc(formatSI((d.series.n - 1) * d.series.dt, 's'))} long, ${esc(formatSI(d.series.dt, 's'))} per sample">${d.series.n.toLocaleString('en')} Sa · ${esc(formatSI((d.series.n - 1) * d.series.dt, 's'))} · <span class="rate">${esc(App.series.rateText(d.series))}</span></span>
        <button id="btn-redetect" class="small" title="Reset all channel scales to fit the data">Auto scale</button></div>
      <div class="field"><label>Time / div</label><input data-w="tdiv" value="${esc(formatSI(w.tdiv, 's'))}"><span></span></div>
      <div class="field"><label>Time at centre</label><input data-w="tCenter" value="${esc(formatSI(w.tCenter, 's'))}"><span></span></div>
      <table class="ch-table series-ch"><tr><th>Ch</th><th>On</th><th>Name</th><th>Scale / div</th><th>Centre value</th></tr>`;
    for (const col of d.series.cols) {
      const cc = c.channels[col.id], color = App.calib.channelById(col.id).color;
      html += `<tr class="${cc.on ? '' : 'off'}">
        <td><span class="chip" style="--c:${color}" title="${esc(col.name)} [${esc(col.unit)}]">${col.id}</span></td>
        <td><input type="checkbox" data-on="${col.id}" ${cc.on ? 'checked' : ''}></td>
        <td><input data-chname="${col.id}" value="${esc((d.chNames || {})[col.id] || '')}" placeholder="name" title="Channel name, shown as ${col.id} (name) in the plot and readout. Column header: ${esc(col.name)}"></td>
        <td><input data-vdiv="${col.id}" value="${esc(formatSI(cc.vdiv, cc.unit))}" title="Wheel or ↑/↓: 1-2-5 steps" ${cc.on ? '' : 'disabled'}></td>
        <td><input data-centre="${col.id}" value="${esc(formatSI(centreOf(c, col.id), cc.unit))}" ${cc.on ? '' : 'disabled'}></td></tr>`;
    }
    html += '</table>';
    if (d.notes && d.notes.length) html += `<ul class="notes series-notes">${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
    return html;
  }
  /** Keep the time/div + centre fields in step with zoom/pan (unless the user is typing in them). */
  function syncSeriesWindow() {
    const d = App.docs.active(); if (!d || d.kind !== 'series') return;
    const w = seriesWindow(d);
    for (const k of ['tdiv', 'tCenter']) {
      const el = document.querySelector(`#calib [data-w="${k}"]`);
      if (el && el !== document.activeElement) el.value = formatSI(w[k], 's');
    }
  }

  function onSeriesChange(d, t, bad) {
    const c = d.calib, s = d.series, ppd = App.calib.pxPerDivY(c), cy = (c.grid.top + c.grid.bottom) / 2;
    if (t.dataset.w) {
      const p = parseSI(t.value, 's'), w = seriesWindow(d);
      if (!p || (t.dataset.w === 'tdiv' && p.value <= 0)) return bad();
      w[t.dataset.w] = p.value;
      const half = w.tdiv * 10 / s.dt / 2, mid = App.calib.xAt(c, w.tCenter);
      App.view.setWindow(d, mid - half, mid + half);
      syncSeriesWindow();
    } else if (t.dataset.chname) {
      d.chNames = { ...(d.chNames || {}), [t.dataset.chname]: t.value.trim() };
      App.docs.touch(d, 'cursors');
    } else if (t.dataset.on) {
      c.channels[t.dataset.on].on = t.checked;
      App.docs.touch(d, 'calib');
    } else if (t.dataset.vdiv) {   // keep the centre value while rescaling, like a scope
      const p = parseSI(t.value, null);
      if (!p || p.value <= 0) return bad();
      App.series.setScale(d, t.dataset.vdiv, p.value, cy);
      App.docs.touch(d, 'calib');
    } else if (t.dataset.centre) {
      const ch = c.channels[t.dataset.centre], p = parseSI(t.value, ch.unit);
      if (!p) return bad();
      ch.zeroY = cy + p.value / ch.vdiv * ppd;
      App.docs.touch(d, 'calib');
    }
  }

  /** Series: step a channel's scale/div through 1-2-5 (dir +1 = coarser). Keeps the centre value. */
  function stepSeriesScale(id, dir) {
    const d = App.docs.active(); if (!d || d.kind !== 'series') return;
    const ch = d.calib.channels[id]; if (!ch || !ch.on) return;
    App.series.setScale(d, id, App.util.step125(ch.vdiv, dir));
    App.docs.touch(d, 'calib');
    const inp = document.querySelector(`#calib [data-vdiv="${id}"]`);
    if (inp) inp.focus();
  }

  function onCalibChange(e) {
    const d = App.docs.active(); if (!d) return;
    const t = e.target, c = d.calib, st = d.status;
    const bad = () => { t.classList.add('invalid'); setTimeout(renderCalib, 900); };
    if (d.kind === 'series') return onSeriesChange(d, t, bad);
    if (t.dataset.k) {
      const p = parseSI(t.value, 's');
      if (!p || (t.dataset.k === 'tdiv' && p.value <= 0)) return bad();
      c.time[t.dataset.k] = p.value; st.time[t.dataset.k] = 'manual';
      App.docs.touch(d, 'cursors');
    } else if (t.dataset.on) {
      c.channels[t.dataset.on].on = t.checked;
      if (t.checked && !st.channels[t.dataset.on]) st.channels[t.dataset.on] = { vdiv: 'manual', zeroY: 'manual' };
      App.docs.touch(d, 'calib');
    } else if (t.dataset.vdiv) {
      const p = parseSI(t.value, null);
      if (!p || p.value <= 0) return bad();
      const ch = c.channels[t.dataset.vdiv];
      ch.vdiv = p.value; if (p.unit) ch.unit = p.unit.toUpperCase();
      st.channels[t.dataset.vdiv] = { ...(st.channels[t.dataset.vdiv] || {}), vdiv: 'manual' };
      App.docs.touch(d, 'cursors');
    } else if (t.dataset.zero) {
      const y = parseFloat(t.value);
      if (!isFinite(y)) return bad();
      c.channels[t.dataset.zero].zeroY = y;
      st.channels[t.dataset.zero] = { ...(st.channels[t.dataset.zero] || {}), zeroY: 'manual' };
      App.docs.touch(d, 'cursors');
    } else if (t.dataset.grid) {
      const v = parseFloat(t.value);
      if (!isFinite(v) || (/div/.test(t.dataset.grid) && v <= 0)) return bad();
      c.grid[t.dataset.grid] = v; st.grid = 'manual';
      App.docs.touch(d, 'calib');
    } else if (t.id === 'chk-persist') {
      c.persistence = t.checked;
      c.persistChannel = t.checked ? (c.selected && c.channels[c.selected].on ? c.selected : Object.keys(c.channels).find(k => c.channels[k].on) || null) : null;
      App.docs.touch(d, 'calib');
    }
  }

  // ---------------------------------------------------------------- status bar
  function renderStatus(h) {
    const d = App.docs.active();
    $('#status-doc').textContent = !d ? '' : d.kind === 'series' ? `${d.name} — ${d.width.toLocaleString('en')} samples @ ${formatSI(1 / d.series.dt, 'Sa/s')}` : `${d.name} — ${d.width}×${d.height}`;
    if (!d || !h) { $('#status-hover').innerHTML = ''; return; }
    const t = App.calib.tAt(d.calib, h.ix);
    let s = `<span>t = ${formatSI(t, 's')}</span>`;
    for (const ch of App.calib.CHANNELS) {
      const cc = d.calib.channels[ch.id];
      if (!cc.on) continue;
      s += `<span style="color:${ch.color}">${esc(App.calib.chLabel(d, ch.id))} = ${formatSI(App.calib.vAt(d.calib, ch.id, h.iy), cc.unit)}</span>`;
    }
    s += `<span class="muted">px ${h.ix.toFixed(0)}, ${h.iy.toFixed(0)}</span>`;
    $('#status-hover').innerHTML = s;
  }

  // ---------------------------------------------------------------- toasts / busy
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  function renderAll() {
    const d = App.docs.active();
    document.body.classList.toggle('empty', !App.docs.list().length);
    document.body.classList.toggle('series', !!(d && d.kind === 'series'));
    renderStrip(); renderReadout(); renderCalib(); renderStatus(null);
    syncToggles(); applyPanelSize();
    App.view.render();
    if (!d) return;
  }

  // ---------------------------------------------------------------- splitter (stage | panel)
  const isNarrow = () => window.matchMedia('(max-aspect-ratio: 3/2)').matches;
  function applyPanelSize() {
    const st = document.documentElement.style;
    if (prefs.panelW) st.setProperty('--panel-w', prefs.panelW + 'px'); else st.removeProperty('--panel-w');
    if (prefs.panelH) st.setProperty('--panel-h', prefs.panelH + 'px'); else st.removeProperty('--panel-h');
  }
  function initSplitter() {
    const sp = $('#splitter');
    let active = false;
    sp.addEventListener('pointerdown', e => { if (e.button === 0) { active = true; sp.setPointerCapture(e.pointerId); sp.classList.add('active'); } });
    sp.addEventListener('pointermove', e => {
      if (!active) return;
      const main = $('main').getBoundingClientRect();
      if (isNarrow()) {
        const bottom = $('.strip').getBoundingClientRect().top;
        prefs.panelH = Math.round(App.util.clamp(bottom - e.clientY, 100, main.height - 200));
      } else prefs.panelW = Math.round(App.util.clamp(main.right - e.clientX, 260, main.width * 0.6));
      applyPanelSize();
    });
    const end = () => { if (!active) return; active = false; sp.classList.remove('active'); App.docs.touch(App.docs.active() || null, 'prefs'); };
    sp.addEventListener('pointerup', end);
    sp.addEventListener('pointercancel', end);
    sp.addEventListener('dblclick', () => { prefs.panelW = prefs.panelH = null; applyPanelSize(); App.docs.touch(App.docs.active() || null, 'prefs'); });
  }

  function syncToggles() {
    $('#tgl-overlay').classList.toggle('on', prefs.showOverlay);
  }

  function togglePref(k) { prefs[k] = !prefs[k]; syncToggles(); App.view.render(); App.docs.touch(App.docs.active() || null, 'prefs'); }

  function init() {
    $('#strip-list').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { App.docs.remove(del.dataset.del); return; }
      const ren = e.target.closest('[data-rename]');
      if (ren) { App.docs.setActive(ren.dataset.rename); startRename(ren.dataset.rename); return; }
      const li = e.target.closest('.thumb');
      if (li) App.docs.setActive(li.dataset.id);
    });
    // horizontal gallery (narrow layout): mouse wheel scrolls sideways
    $('#strip-list').addEventListener('wheel', e => {
      const el = e.currentTarget;
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 33 : 1); e.preventDefault();
    }, { passive: false });
    $('#strip-list').addEventListener('dblclick', e => {
      const li = e.target.closest('.thumb');
      if (li && e.target.closest('.thumb-meta')) startRename(li.dataset.id);
    });
    initSplitter();
    $('#probe-btns').addEventListener('click', e => { const b = e.target.closest('[data-probe]'); if (b) toggleProbe(b.dataset.probe); });
    $('#calib').addEventListener('change', onCalibChange);
    $('#calib').addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.blur();
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset.vdiv && App.docs.active().kind === 'series') {
        e.preventDefault(); stepSeriesScale(e.target.dataset.vdiv, e.key === 'ArrowUp' ? 1 : -1);
      }
    });
    $('#calib').addEventListener('wheel', e => {
      const t = e.target.closest && e.target.closest('[data-vdiv]');
      if (!t || t.disabled || App.docs.active().kind !== 'series' || !e.deltaY) return;
      e.preventDefault(); stepSeriesScale(t.dataset.vdiv, e.deltaY < 0 ? -1 : 1);
    }, { passive: false });
    $('#calib').addEventListener('click', e => {
      const d = App.docs.active(); if (!d) return;
      if (e.target.id === 'btn-redetect') { App.docs.touch(d, 'detect'); toast(d.kind === 'series' ? 'Scales reset to fit the data.' : 'Detection re-run.'); }
      if (e.target.id === 'btn-pickgrid') { App.view.setMode({ type: 'pick-grid' }); toast('Drag a rectangle over the graticule (outer grid border).'); }
      const pz = e.target.closest('[data-pickzero]');
      if (pz) { App.view.setMode({ type: 'pick-zero', ch: pz.dataset.pickzero }); toast(`Click on the image at the 0 level of ${pz.dataset.pickzero}.`); }
    });
    $('#readout').addEventListener('click', e => {
      const b = e.target.closest('[data-cursor]'); if (b) App.view.selectCursor(+b.dataset.cursor);
      const ns = e.target.closest('[data-nstep]'); if (ns) App.view.stepPeriods(+ns.dataset.nstep);
    });

    App.events.on('docs-changed', () => { document.body.classList.toggle('empty', !App.docs.list().length); renderStrip(); renderStatus(null); });
    App.events.on('active-changed', renderAll);
    App.events.on('doc-updated', (d, what) => {
      if (d !== App.docs.active()) return;
      renderReadout();
      if (what !== 'cursors' && what !== 'prefs') { renderCalib(); renderStrip(); }
      App.view.render();
    });
    App.events.on('hover', renderStatus);
    App.events.on('window', syncSeriesWindow);
    App.events.on('toast', toast);
    App.events.on('zoom', s => { $('#zoom-level').textContent = Math.round(s * 100) + '%'; });
    App.events.on('mode', m => { document.body.classList.toggle('picking', !!m); });
    App.events.on('busy', b => document.body.classList.toggle('busy', b));
  }

  return { init, prefs, renderAll, toast, togglePref, readoutTSV, startRename };
})();
