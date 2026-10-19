// DOM panels around the canvas: thumbnail strip, cursor readout, calibration editor,
// status bar, toasts. Rendering is plain template strings; re-render on events.
App.ui = (() => {
  const { formatSI, formatRange, formatRate, parseSI, escapeHtml: esc } = App.util;
  const $ = sel => document.querySelector(sel);
  const prefs = { showOverlay: false, showValueLabels: true };

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
  function renderReadout() {
    const d = App.docs.active(), box = $('#readout');
    $('#tgl-periods').classList.toggle('on', !!(d && d.cursors.periods));
    if (!d) { box.innerHTML = '<p class="muted">No image loaded.</p>'; return; }
    const ro = App.measure.cursorReadout(d);
    const C = App.view.CURSOR_COLORS;
    const sel = d.cursors.sel, P = ro.periods;
    const val = (x, unit) => x ? `<span class="v">${formatSI(x.v, unit, 4)}</span>${x.vMax - x.vMin > 1e-12 ? `<span class="band" title="Displayed band (trace thickness / sample block / persistence spread)">${formatRange(x.vMin, x.vMax, unit)}</span>` : ''}` : '<span class="v muted">no trace</span>';
    let rows = `
      <tr><th></th><th><button class="cur-tag ${sel === 1 ? 'sel' : ''}" data-cursor="1" style="--c:${C[1]}">1</button></th>
          <th><button class="cur-tag ${sel === 2 ? 'sel' : ''}" data-cursor="2" style="--c:${C[2]}">2</button></th><th>Δ (2−1)</th></tr>
      <tr><td class="lbl">t</td><td>${formatSI(ro.t1, 's')}</td><td>${formatSI(ro.t2, 's')}</td><td class="strong">${formatSI(ro.dt, 's')}</td></tr>
      <tr><td class="lbl">1/Δt</td><td></td><td></td><td class="${P ? '' : 'strong'}">${formatSI(ro.freq, 'Hz')}</td></tr>`;
    if (P) rows += `
      <tr class="period-row"><td class="lbl">periods</td><td colspan="2"><span class="nstep"><button data-nstep="-1" title="One period less (,)">−</button><b>N = ${P.n}</b><button data-nstep="1" title="One period more (.)">+</button></span></td><td>T = ${formatSI(P.period, 's', 5)}</td></tr>
      <tr><td class="lbl">N/Δt</td><td></td><td></td><td class="strong" title="Frequency measured over ${P.n} period${P.n > 1 ? 's' : ''}">${formatSI(P.freq, 'Hz', 5)}</td></tr>`;
    ro.channels.forEach((c, i) => {
      const col = App.calib.channelById(c.id).color;
      rows += `
      <tr class="ch-row ${c.alt ? 'alt' : ''}"><td class="lbl"><span class="chip ${c.alt ? 'hollow' : ''}" style="--c:${col}" ${c.alt ? 'title="Second branch: the persistence display splits into two waveform populations here"' : ''}>${c.id}${c.alt ? ' ②' : ''}</span></td>
        <td>${val(c.a, c.unit)}</td><td>${val(c.b, c.unit)}</td><td class="strong">${formatSI(c.dv, c.unit)}</td></tr>
      <tr class="slope-row"><td class="lbl">ΔV/Δt</td><td colspan="2"></td><td class="strong">${formatRate(c.slope, c.unit)}</td></tr>`;
      const pc = P && P.channels[i];
      if (pc) rows += `
      <tr class="slope-row" title="Per cycle: ${pc.cycles.map(x => formatSI(x, c.unit, 3)).join(', ')} pk-pk"><td class="lbl">amplitude</td>
        <td colspan="2">${pc.pp !== null ? `${formatSI(pc.pp, c.unit, 4)} pp avg` : ''}</td>
        <td class="strong">${pc.amp !== null ? `<span class="v">${formatSI(pc.amp, c.unit, 4)}</span><span class="band" title="Smallest … largest cycle">${formatRange(pc.ampMin, pc.ampMax, c.unit)}</span>` : '<span class="muted">no trace</span>'}</td></tr>`;
    });
    box.innerHTML = `<table class="readout">${rows}</table>`;
  }

  function readoutTSV() {
    const d = App.docs.active(); if (!d) return '';
    const ro = App.measure.cursorReadout(d);
    const head = ['image', 't1 [s]', 't2 [s]', 'dt [s]', '1/dt [Hz]'], vals = [d.name, ro.t1, ro.t2, ro.dt, ro.freq];
    const P = ro.periods;
    if (P) { head.push('periods N', 'T [s]', 'N/dt [Hz]'); vals.push(P.n, P.period, P.freq); }
    ro.channels.forEach((c, i) => {
      const n = c.alt ? `${c.id} branch2` : c.id;
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
    if (!d) { box.innerHTML = ''; return; }
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

  function onCalibChange(e) {
    const d = App.docs.active(); if (!d) return;
    const t = e.target, c = d.calib, st = d.status;
    const bad = () => { t.classList.add('invalid'); setTimeout(renderCalib, 900); };
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
    $('#status-doc').textContent = d ? `${d.name} — ${d.width}×${d.height}` : '';
    if (!d || !h) { $('#status-hover').innerHTML = ''; return; }
    const t = App.calib.tAt(d.calib, h.ix);
    let s = `<span>t = ${formatSI(t, 's')}</span>`;
    for (const ch of App.calib.CHANNELS) {
      const cc = d.calib.channels[ch.id];
      if (!cc.on) continue;
      s += `<span style="color:${ch.color}">${ch.id} = ${formatSI(App.calib.vAt(d.calib, ch.id, h.iy), cc.unit)}</span>`;
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
    renderStrip(); renderReadout(); renderCalib(); renderStatus(null);
    syncToggles();
    App.view.render();
    if (!d) return;
  }

  function syncToggles() {
    $('#tgl-overlay').classList.toggle('on', prefs.showOverlay);
    $('#tgl-labels').classList.toggle('on', prefs.showValueLabels);
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
    $('#strip-list').addEventListener('dblclick', e => {
      const li = e.target.closest('.thumb');
      if (li && e.target.closest('.thumb-meta')) startRename(li.dataset.id);
    });
    $('#calib').addEventListener('change', onCalibChange);
    $('#calib').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    $('#calib').addEventListener('click', e => {
      const d = App.docs.active(); if (!d) return;
      if (e.target.id === 'btn-redetect') { App.docs.touch(d, 'detect'); toast('Detection re-run.'); }
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
    App.events.on('toast', toast);
    App.events.on('zoom', s => { $('#zoom-level').textContent = Math.round(s * 100) + '%'; });
    App.events.on('mode', m => { document.body.classList.toggle('picking', !!m); });
    App.events.on('busy', b => document.body.classList.toggle('busy', b));
  }

  return { init, prefs, renderAll, toast, togglePref, readoutTSV, startRename };
})();
