// DOM panels around the canvas: thumbnail strip, cursor readout, calibration editor,
// status bar, toasts. Rendering is plain template strings; re-render on events.
App.ui = (() => {
  const { formatSI, formatRange, formatRate, parseSI, escapeHtml: esc } = App.util;
  const $ = sel => document.querySelector(sel);
  const prefs = { showOverlay: false, bigText: false, panelW: null, panelH: null };   // panelW/H: splitter positions (px), null = CSS default

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
          ${d.kind === 'series' ? `<button data-merge="${d.id}" title="Merge with another CSV into one plot (M). Or drag this thumbnail onto another one">⧉</button>` : ''}
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

  // ---------------------------------------------------------------- strip: drag a thumbnail onto another = merge
  // Pointer events, not HTML drag & drop (that would trigger the window's file-drop overlay).
  const DRAG_PX = 6;
  let stripDrag = null;      // { id, x0, y0, pid, on, ghost, target }
  let noClickUntil = 0;      // swallow the click that ends a drag
  const canMerge = (a, b) => a && b && a !== b && a.kind === 'series' && b.kind === 'series';
  function initStripDrag() {
    const list = $('#strip-list');
    list.addEventListener('pointerdown', e => {
      const li = e.target.closest('.thumb');
      if (li && e.button === 0 && !e.target.closest('button, input')) stripDrag = { id: li.dataset.id, x0: e.clientX, y0: e.clientY, pid: e.pointerId, on: false, target: null };
    });
    list.addEventListener('pointermove', e => {
      const s = stripDrag; if (!s) return;
      if (!s.on) {
        if (Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < DRAG_PX) return;
        s.on = true; list.setPointerCapture(s.pid);
        const src = list.querySelector(`.thumb[data-id="${s.id}"]`);
        if (src) src.classList.add('drag-src');
        s.ghost = document.createElement('div'); s.ghost.className = 'thumb-ghost';
        s.ghost.innerHTML = `<img src="${App.docs.get(s.id).thumbUrl}" alt="">`;
        document.body.appendChild(s.ghost);
      }
      s.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
      const el = document.elementFromPoint(e.clientX, e.clientY), li = el && el.closest('#strip-list .thumb');
      const t = li && li.dataset.id !== s.id ? li.dataset.id : null;
      if (t === s.target) return;
      list.querySelectorAll('.merge-target').forEach(x => x.classList.remove('merge-target', 'bad'));
      s.target = t;
      if (t) li.classList.add('merge-target', ...(canMerge(App.docs.get(s.id), App.docs.get(t)) ? [] : ['bad']));
    });
    const end = e => {
      const s = stripDrag; stripDrag = null;
      if (!s || !s.on) return;
      noClickUntil = Date.now() + 300;
      s.ghost.remove();
      list.querySelectorAll('.drag-src, .merge-target').forEach(x => x.classList.remove('drag-src', 'merge-target', 'bad'));
      if (e.type !== 'pointerup' || !s.target) return;
      const a = App.docs.get(s.id), b = App.docs.get(s.target);
      if (canMerge(a, b)) openMerge(a.id, b.id);
      else toast('Only CSV waveforms can be merged. Screenshots have no sample data to combine.');
    };
    list.addEventListener('pointerup', end);
    list.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- merge dialog
  // Builds a new merged view (App.docs.addMerged) from two CSV docs (either may itself be merged).
  // One row per channel of both: use it, its name, and the channel (C1..C4) it becomes.
  const SLOTS = ['C1', 'C2', 'C3', 'C4'];
  const shortName = n => String(n).replace(/\.[^.]+$/, '');
  let merge = null;   // { rows, tgt, src } while the dialog is open
  function mergeRows(tgt, src) {
    const rows = [];
    for (const d of [tgt, src]) for (const col of d.series.cols) {
      const cc = d.calib.channels[col.id];
      // unnamed channels of the added recording are named after it ("WFM05 C1"), they usually change slot
      const name = (d.chNames || {})[col.id] || (d === tgt ? col.id : `${shortName(d.name)} ${col.id}`);
      rows.push({ d, id: col.id, on: cc.on, use: false, slot: null, name });
    }
    const free = () => SLOTS.find(sl => !rows.some(r => r.use && r.slot === sl));
    // the target keeps its channels, the added ones take free slots; channels that are off stay out
    for (const r of rows) if (r.d === tgt && r.on) { r.use = true; r.slot = r.id; }
    for (const r of rows) if (r.d !== tgt && r.on && free()) { r.slot = free(); r.use = true; }
    for (const r of rows) if (!r.slot) r.slot = r.id;
    // the same name in both recordings: add the recording's name
    for (const r of rows) if (rows.some(x => x.d !== r.d && x.name === r.name)) r.name += ` · ${shortName(r.d.name)}`;
    return rows;
  }
  function renderMerge() {
    const dlg = $('#merge-dlg'), { rows, tgt, src } = merge;
    const used = rows.filter(r => r.use);
    dlg.querySelector('#mg-rows').innerHTML = rows.map((r, i) => `<tr class="${r.use ? '' : 'off'}">
      <td><input type="checkbox" data-muse="${i}" ${r.use ? 'checked' : ''} aria-label="Use ${esc(r.d.name)} ${r.id}"></td>
      <td class="mg-from" title="${esc(r.d.name)}">${esc(shortName(r.d.name))}</td>
      <td><span class="chip" style="--c:${App.calib.channelById(r.id).color}">${r.id}</span></td>
      <td><input data-mname="${i}" value="${esc(r.name)}" ${r.use ? '' : 'disabled'} aria-label="Name"></td>
      <td><select data-mslot="${i}" ${r.use ? '' : 'disabled'} aria-label="Becomes channel">${SLOTS.map(sl => `<option ${sl === r.slot ? 'selected' : ''}>${sl}</option>`).join('')}</select></td></tr>`).join('');
    const msg = !used.length ? 'Choose at least one channel.' : rows.length > SLOTS.length && used.length === SLOTS.length ? 'One view shows at most 4 channels (C1–C4). Untick one to use another.' : '';
    dlg.querySelector('#mg-note').textContent = msg;
    dlg.querySelector('#mg-name').textContent = `${shortName(tgt.name)} + ${shortName(src.name)}`;
    dlg.querySelector('[data-act="ok"]').disabled = !used.length || tgt === src;
  }
  function onMergeInput(e) {
    const t = e.target, r = merge.rows[t.dataset.muse || t.dataset.mname || t.dataset.mslot];
    if (t.id === 'mg-tgt' || t.id === 'mg-src') {
      const tgt = App.docs.get($('#mg-tgt').value), src = App.docs.get($('#mg-src').value);
      Object.assign(merge, { tgt, src, rows: tgt === src ? [] : mergeRows(tgt, src) });
    } else if (t.dataset.muse) {
      const taken = merge.rows.filter(x => x.use);
      if (t.checked && taken.length >= SLOTS.length) { t.checked = false; return; }
      r.use = t.checked;
      if (r.use && taken.some(x => x.slot === r.slot)) r.slot = SLOTS.find(sl => !taken.some(x => x.slot === sl));
    } else if (t.dataset.mname) { r.name = t.value; return; }
    else if (t.dataset.mslot) {   // a slot already in use: the two channels swap
      const other = merge.rows.find(x => x !== r && x.use && x.slot === t.value);
      if (other) other.slot = r.slot;
      r.slot = t.value;
    }
    renderMerge();
  }
  /** Open the merge dialog: add doc srcId to doc tgtId (defaults: the active CSV and the next one). */
  function openMerge(srcId, tgtId) {
    const cands = App.docs.list().filter(d => d.kind === 'series');
    if (cands.length < 2) { toast('Load at least two CSV waveforms to merge them into one plot.'); return; }
    const act = App.docs.active();
    const src = App.docs.get(srcId) || (act && act.kind === 'series' ? act : cands[0]);
    const tgt = App.docs.get(tgtId) || cands[(cands.indexOf(src) + 1) % cands.length];
    if (!canMerge(src, tgt)) return;
    merge = { tgt, src, rows: mergeRows(tgt, src) };
    const opts = sel => cands.map(d => `<option value="${d.id}" ${d === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    $('#mg-tgt').innerHTML = opts(tgt); $('#mg-src').innerHTML = opts(src);
    $('#mg-remove').checked = false;
    renderMerge();
    const dlg = $('#merge-dlg');
    dlg.showModal();
    dlg.querySelector('[data-act="ok"]').focus();
  }
  async function doMerge() {
    const { tgt, src, rows } = merge, parts = [], data = [], chNames = {}, channels = {};
    for (const d of [tgt, src]) {
      // a merged doc brings its recordings (with their shifts), a plain CSV is one recording
      const own = d.parts ? d.parts.map((p, k) => [p, d.partData[k]]) : [[{ name: d.name, blob: d.blob, shift: 0, map: Object.fromEntries(d.series.cols.map(c => [c.id, c.id])) }, d.series]];
      for (const [p, pd] of own) {
        const map = {};
        for (const [from, id] of Object.entries(p.map)) { const r = rows.find(x => x.use && x.d === d && x.id === id); if (r) map[from] = r.slot; }
        if (Object.keys(map).length) { parts.push({ name: p.name, blob: p.blob, shift: p.shift || 0, map }); data.push(pd); }
      }
    }
    // the first recording is the time reference: its shift is 0, the others' shifts are offsets against it
    const ref = parts[0].shift;
    parts.forEach(p => { p.shift -= ref; });
    for (const r of rows.filter(x => x.use)) {
      const cc = r.d.calib.channels[r.id];
      chNames[r.slot] = r.name.trim() === r.slot ? '' : r.name.trim();
      channels[r.slot] = { on: true, vdiv: cc.vdiv, zeroY: cc.zeroY, unit: cc.unit };
    }
    // cursors and the visible time window come from the target
    const c = tgt.calib, w = App.view.getWindow(tgt);
    const setup = { chNames, channels, t1: App.calib.tAt(c, tgt.cursors.x1), t2: App.calib.tAt(c, tgt.cursors.x2), tA: App.calib.tAt(c, w.xa), tB: App.calib.tAt(c, w.xb) };
    const doc = await App.docs.addMerged(`${shortName(tgt.name)} + ${shortName(src.name)}`, parts, data, setup, tgt.id);
    const notes = [tgt, src].filter(d => d.userNotes).map(d => `[${shortName(d.name)}]\n${d.userNotes.trim()}`);
    if (notes.length) { doc.userNotes = notes.join('\n\n'); App.docs.touch(doc, 'notes'); }
    if ($('#mg-remove').checked) { await App.docs.remove(src.id); await App.docs.remove(tgt.id); }
    App.docs.setActive(doc.id);
    toast('Merged. Shift a recording in time under Recordings in the Display panel, or Ctrl+drag its curve.');
  }
  function initMergeDialog() {
    const dlg = $('#merge-dlg');
    dlg.addEventListener('change', onMergeInput);
    dlg.addEventListener('input', e => { if (e.target.dataset.mname) onMergeInput(e); });
    dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-act="ok"]').addEventListener('click', () => {
      dlg.close();
      doMerge().catch(e => toast(`Merge failed: ${e.message}`));
    });
    dlg.addEventListener('close', () => { merge = null; });
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
    if (!p.includes(id)) d.axisCh = id;   // the channel switched on last labels the y axis (CSV)
    App.docs.touch(d, 'cursors');
    if (d.kind === 'series') renderCalib();
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

  // ---------------------------------------------------------------- one-step undo for bulk changes
  // Auto scale / Re-detect and Paste display settings replace many values at once. The button that
  // did it turns into "Undo" for UNDO_MS; undoing restores the snapshot taken just before.
  const UNDO_MS = 10000;
  let undo = null;   // { docId, btn, label, snap, timer }
  const SNAP_KEYS = ['calib', 'status', 'notes', 'raw', 'layoutId', 'layoutName', 'axisCh'];
  function snapshot(d) {
    const snap = JSON.parse(JSON.stringify(Object.fromEntries(SNAP_KEYS.map(k => [k, d[k] === undefined ? null : d[k]]))));
    if (d.kind === 'series') snap.window = { ...App.view.getWindow(d) };
    if (d.parts) { snap.shifts = d.parts.map(p => p.shift || 0); snap.cursors = JSON.parse(JSON.stringify(d.cursors)); }
    return snap;
  }
  /** Run a bulk change on doc d with an undo offered on button `btn` (id) for a few seconds. */
  function withUndo(d, btn, label, fn) {
    const snap = snapshot(d);
    fn();
    if (undo) clearTimeout(undo.timer);
    undo = { docId: d.id, btn, label, snap, timer: setTimeout(() => { undo = null; renderCalib(); }, UNDO_MS) };
    renderCalib();
  }
  function doUndo() {
    const d = undo && App.docs.get(undo.docId); if (!d) return;
    const { snap, label } = undo;
    clearTimeout(undo.timer); undo = null;
    if (snap.shifts) { d.parts.forEach((p, k) => { p.shift = snap.shifts[k]; }); App.docs.remerge(d); }
    for (const k of SNAP_KEYS) d[k] = snap[k];
    if (snap.cursors) d.cursors = snap.cursors;   // in the restored grid's sample index (remerge above)
    if (snap.window) App.view.setWindow(d, snap.window.xa, snap.window.xb);
    if (snap.shifts) App.docs.remerge(d, true); else App.docs.touch(d, 'calib');
    toast(`${label} undone.`);
  }
  /** A bulk-change button, or "Undo" in its place while its undo is pending. */
  function undoable(d, id, text, title) {
    if (undo && undo.docId === d.id && undo.btn === id) return `<button id="btn-undo" class="small undo" title="Undo ${esc(undo.label)} (offered for ${UNDO_MS / 1000} s)">↶ Undo</button>`;
    return `<button id="${id}" class="small" title="${title}">${text}</button>`;
  }

  // Display settings clipboard (series docs): per channel on/scale/offset, the time window, axis channel.
  let copiedDisplay = null;
  function copyDisplay(d) {
    const c = d.calib, w = App.view.getWindow(d);
    copiedDisplay = {
      from: d.name, axisCh: App.series.axisChannel(d),
      tA: App.calib.tAt(c, w.xa), tB: App.calib.tAt(c, w.xb),
      channels: Object.fromEntries(d.series.cols.map(col => { const cc = c.channels[col.id]; return [col.id, { on: cc.on, vdiv: cc.vdiv, zeroY: cc.zeroY, unit: cc.unit }]; })),
    };
    toast(`Display settings of ${d.name} copied. Select another CSV and press Paste.`);
    renderCalib();
  }
  function pasteDisplay(d) {
    const src = copiedDisplay, c = d.calib, skipped = [];
    withUndo(d, 'btn-pastedisp', 'Paste display settings', () => {
      for (const col of d.series.cols) {
        const from = src.channels[col.id], cc = c.channels[col.id];
        if (!from) continue;
        if (from.unit !== cc.unit) { skipped.push(`${col.id} (${from.unit} → ${cc.unit})`); continue; }
        Object.assign(cc, { on: from.on, vdiv: from.vdiv, zeroY: from.zeroY });
      }
      if (src.axisCh && c.channels[src.axisCh]) d.axisCh = src.axisCh;
      App.view.setWindow(d, App.calib.xAt(c, src.tA), App.calib.xAt(c, src.tB));
      App.docs.touch(d, 'calib');
    });
    toast(`Display settings of ${src.from} pasted.` + (skipped.length ? ` Skipped, different unit: ${skipped.join(', ')}.` : ''));
  }

  // ---------------------------------------------------------------- calibration editor
  // Channel unit V <-> A (current probes, current columns read as volts). Values stay, only the unit changes.
  const unitBtn = (id, cc) => {
    const u = cc.unit || 'V', to = u === 'A' ? 'V' : 'A';
    return `<button class="unit-tgl" data-unit="${id}" title="Unit of ${id}: ${esc(u)}. Click to switch to ${to} (e.g. current probe)" ${cc.on ? '' : 'disabled'}>${esc(u)}</button>`;
  };
  function flipUnit(d, id) {
    const cc = d.calib.channels[id];
    cc.unit = cc.unit === 'A' ? 'V' : 'A';
    if (d.kind !== 'series') d.status.channels[id] = { ...(d.status.channels[id] || {}), vdiv: 'manual' };
    App.docs.touch(d, 'calib');
    toast(`${App.calib.chLabel(d, id)} is now shown in ${cc.unit}.`);
    const b = document.querySelector(`#calib [data-unit="${id}"]`);
    if (b) b.focus();
  }

  function renderCalib() {
    const d = App.docs.active(), box = $('#calib');
    $('#calib-title').textContent = d && d.kind === 'series' ? 'Display' : 'Calibration';
    if (!d) { box.innerHTML = ''; return; }
    if (d.kind === 'series') { box.innerHTML = seriesDisplayHtml(d); return; }
    const c = d.calib, st = d.status;
    const g = c.grid;
    let html = `
      <div class="layout-row"><span class="layout-name">${esc(d.layoutName || '')}</span>${badge(d.layoutId ? 'ok' : 'manual')}
        ${undoable(d, 'btn-redetect', 'Re-detect', 'Discard manual edits and run detection again')}</div>
      <div class="field"><label>Time / div</label><input data-k="tdiv" value="${esc(formatSI(c.time.tdiv, 's'))}">${badge(st.time.tdiv)}</div>
      <div class="field"><label>Time at centre</label><input data-k="tCenter" value="${esc(formatSI(c.time.tCenter, 's'))}">${badge(st.time.tCenter)}</div>
      <table class="ch-table"><tr><th>Ch</th><th>On</th><th>Scale / div</th><th>0 level (y px)</th></tr>`;
    for (const ch of App.calib.CHANNELS) {
      const cc = c.channels[ch.id], s = st.channels[ch.id] || {};
      html += `<tr class="${cc.on ? '' : 'off'}">
        <td><span class="chip" style="--c:${ch.color}">${ch.id}</span></td>
        <td><input type="checkbox" data-on="${ch.id}" ${cc.on ? 'checked' : ''}></td>
        <td><span class="nowrap"><input data-vdiv="${ch.id}" value="${esc(formatSI(cc.vdiv, cc.unit || 'V'))}" ${cc.on ? '' : 'disabled'}>${unitBtn(ch.id, cc)}${cc.on ? badge(s.vdiv) : ''}</span></td>
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
    const c = d.calib, w = seriesWindow(d), axis = App.series.axisChannel(d);
    const info = d.parts
      ? `<span class="layout-name one-line" title="${esc(d.parts.map(p => p.name).join(' + '))}">Merged · ${d.parts.length} recordings · ${esc(formatSI((d.series.n - 1) * d.series.dt, 's'))}</span>`
      : `<span class="layout-name one-line" title="CSV: ${d.series.n.toLocaleString('en')} samples, ${esc(formatSI((d.series.n - 1) * d.series.dt, 's'))} long, ${esc(formatSI(d.series.dt, 's'))} per sample">${d.series.n.toLocaleString('en')} Sa · ${esc(formatSI((d.series.n - 1) * d.series.dt, 's'))} · <span class="rate">${esc(App.series.rateText(d.series))}</span></span>`;
    let html = `
      <div class="layout-row">${info}
        ${undoable(d, 'btn-redetect', 'Auto scale', 'Reset all channel scales to fit the data')}</div>
      <div class="field"><label>Time / div</label><input data-w="tdiv" value="${esc(formatSI(w.tdiv, 's'))}"><span></span></div>
      <div class="field"><label>Time at centre</label><input data-w="tCenter" value="${esc(formatSI(w.tCenter, 's'))}"><span></span></div>
      <table class="ch-table series-ch"><tr><th>Ch</th><th>On</th><th>Name</th><th>Scale / div</th><th>Centre value</th></tr>`;
    for (const col of d.series.cols) {
      const cc = c.channels[col.id], color = App.calib.channelById(col.id).color;
      html += `<tr class="${cc.on ? '' : 'off'}">
        <td><button class="chip ${col.id === axis ? 'axis' : ''}" data-axis="${col.id}" style="--c:${color}" title="Label the y axis with ${esc(App.calib.chLabel(d, col.id))} (column ${esc(col.name)} [${esc(col.unit)}])">${col.id}</button></td>
        <td><input type="checkbox" data-on="${col.id}" ${cc.on ? 'checked' : ''}></td>
        <td><input data-chname="${col.id}" value="${esc((d.chNames || {})[col.id] || '')}" placeholder="name" title="Channel name, shown as ${col.id} (name) in the plot and readout. Column header: ${esc(col.name)}"></td>
        <td><span class="nowrap"><input data-vdiv="${col.id}" value="${esc(formatSI(cc.vdiv, cc.unit))}" title="Wheel or ↑/↓: 1-2-5 steps" ${cc.on ? '' : 'disabled'}>${unitBtn(col.id, cc)}</span></td>
        <td><input data-centre="${col.id}" value="${esc(formatSI(centreOf(c, col.id), cc.unit))}" ${cc.on ? '' : 'disabled'}></td></tr>`;
    }
    html += `</table>
      <div class="disp-copy">
        <button id="btn-copydisp" class="small" title="Copy channel scales, offsets, on/off, the visible time window and the axis channel, to paste them into another CSV">Copy settings</button>
        ${copiedDisplay ? undoable(d, 'btn-pastedisp', 'Paste settings', `Apply the display settings copied from ${esc(copiedDisplay.from)}`) : '<button class="small" disabled title="Copy the settings of another CSV first">Paste settings</button>'}
      </div>`;
    if (d.parts) html += recordingsHtml(d);
    if (d.notes && d.notes.length) html += `<ul class="notes series-notes">${d.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`;
    return html;
  }
  // Merged views: the first recording is the time reference; every other one has a single time
  // offset against it (two files = one number), set by typing, Align at the cursors or Ctrl+drag.
  function recordingsHtml(d) {
    const chips = k => d.series.cols.filter(col => col.part === k).map(col => `<span class="chip" style="--c:${App.calib.channelById(col.id).color}">${col.id}</span>`).join('');
    const name = p => `<span class="rec-name" title="${esc(p.name)}">${esc(shortName(p.name))}</span>`;
    const rows = d.parts.slice(1).map((p, i) => {
      const k = i + 1;
      return `<div class="rec-row"><span class="rec-chips">${chips(k)}</span>${name(p)}
        <input data-shift="${k}" value="${esc(formatSI(p.shift || 0, 's', 4))}" title="Time offset of this recording against the reference. Wheel or ↑/↓: 1/10 of the visible time/div (Shift: 1 div). Or Ctrl+drag its curve in the plot.">
        ${undoable(d, `btn-align-${k}`, 'Align', 'Put one cursor on a feature of the reference and the other on the same feature of this recording (either order), then Align: this recording moves so the two features line up')}</div>`;
    }).join('');
    return `<div class="recordings"><div class="rec-head">Time offset against <span class="rec-chips">${chips(0)}</span>${name(d.parts[0])}</div>${rows}
      <p class="tip muted">Align: one cursor on a feature (an edge, a peak) of the reference, the other on the same feature of the other recording, either order, then Align.</p></div>`;
  }
  function syncShifts(d) {
    if (!d.parts) return;
    d.parts.forEach((p, k) => {
      const el = document.querySelector(`#calib [data-shift="${k}"]`);
      if (el && el !== document.activeElement) el.value = formatSI(p.shift || 0, 's', 4);
    });
  }
  /** Step a recording's time shift by 1/10 of the visible time/div (big: one div). */
  function stepShift(d, k, dir, big) {
    const p = d.parts[k];
    p.shift = (p.shift || 0) + dir * seriesWindow(d).tdiv * (big ? 1 : 0.1);
    App.docs.remerge(d, true);
    const inp = document.querySelector(`#calib [data-shift="${k}"]`);
    if (inp) inp.focus();
  }
  /**
   * Align recording k to the reference: one cursor marks a feature of the reference, the other the
   * same feature of recording k, in either order. Which is which: the assignment under which the
   * curves around the two cursors have the more similar shape (App.series.shapeMatch); when that is
   * unclear, cursor 1 = reference. Recording k moves so its feature lands on the reference's cursor,
   * and its cursor follows. -> true if cursor 1 was on recording k.
   */
  function alignAtCursors(d, k) {
    const c = d.calib, s = d.series, t1 = App.calib.tAt(c, d.cursors.x1), t2 = App.calib.tAt(c, d.cursors.x2);
    const cols = part => s.cols.filter(col => col.part === part && c.channels[col.id].on);
    const w = seriesWindow(d).tdiv;   // compare ±1 visible div around each cursor
    const a = App.series.shapeMatch(s, cols(0), t1, cols(k), t2, w), b = App.series.shapeMatch(s, cols(0), t2, cols(k), t1, w);
    const swapped = b !== null && (a === null || b > a + 0.05);
    d.parts[k].shift = (d.parts[k].shift || 0) + (swapped ? t2 - t1 : t1 - t2);
    App.docs.remerge(d);
    if (swapped) d.cursors.x1 = d.cursors.x2; else d.cursors.x2 = d.cursors.x1;
    App.docs.remerge(d, true);
    return swapped;
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
    } else if (t.dataset.shift) {
      const p = parseSI(t.value, 's');
      if (!p) return bad();
      d.parts[+t.dataset.shift].shift = p.value;
      App.docs.remerge(d, true);
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
      d.axisCh = t.dataset.vdiv;
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
    d.axisCh = id;
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
    $('#status-doc').textContent = !d ? '' : d.parts ? `${d.name} — ${d.parts.length} recordings merged` : d.kind === 'series' ? `${d.name} — ${d.width.toLocaleString('en')} samples @ ${formatSI(1 / d.series.dt, 'Sa/s')}` : `${d.name} — ${d.width}×${d.height}`;
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

  // ---------------------------------------------------------------- export dialog
  /**
   * Let the user pick the export format. opts = { exact?, lossless, compact } each
   * { blob, lossy } from App.docs.exportSession (no exact: option hidden). Resolves to the
   * chosen key or null (cancelled).
   */
  function askExport(opts) {
    const dlg = $('#export-dlg');
    $('#exp-now').textContent = formatSI(Math.max(...Object.values(opts).map(o => o.blob.size)), 'B', 3);
    dlg.querySelectorAll('.exp-opt').forEach(el => { el.hidden = !opts[el.querySelector('input').value]; });
    dlg.querySelectorAll('[data-size]').forEach(el => { if (opts[el.dataset.size]) el.textContent = formatSI(opts[el.dataset.size].blob.size, 'B', 3); });
    const lossy = opts.compact.lossy;
    $('#exp-err').innerHTML = lossy.length
      ? lossy.map(l => `<li>${esc(l.name)}: ${esc(l.note.replace(/^.*max error /, '').replace(/\.$/, ''))}</li>`).join('')
      : '<li>no change, the CSVs are already stored at 16 bit</li>';
    dlg.querySelector('input[value="lossless"]').checked = true;
    return new Promise(res => {
      const done = mode => { dlg.onclose = null; dlg.close(); res(mode); };
      dlg.querySelector('[data-act="ok"]').onclick = () => done(dlg.querySelector('input[name="exp-mode"]:checked').value);
      dlg.querySelector('[data-act="cancel"]').onclick = () => done(null);
      dlg.onclose = () => res(null);   // Esc
      dlg.showModal();
      dlg.querySelector('[data-act="ok"]').focus();
    });
  }

  // ---------------------------------------------------------------- notes (free text per doc)
  function renderNotes() {
    const d = App.docs.active(), t = $('#doc-notes');
    t.disabled = !d;
    if (document.activeElement !== t || !d) t.value = (d && d.userNotes) || '';
  }
  function initNotes() {
    const t = $('#doc-notes');
    t.addEventListener('input', () => { const d = App.docs.active(); if (d) { d.userNotes = t.value; App.docs.touch(d, 'notes'); } });
    t.addEventListener('keydown', e => { if (e.key === 'Escape') t.blur(); });
  }

  function renderAll() {
    const d = App.docs.active();
    document.body.classList.toggle('empty', !App.docs.list().length);
    document.body.classList.toggle('series', !!(d && d.kind === 'series'));
    renderStrip(); renderReadout(); renderCalib(); renderNotes(); renderStatus(null);
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
    $('#tgl-bigtext').classList.toggle('on', !!prefs.bigText);
  }

  function togglePref(k) { prefs[k] = !prefs[k]; syncToggles(); App.view.render(); App.docs.touch(App.docs.active() || null, 'prefs'); }

  function init() {
    $('#strip-list').addEventListener('click', e => {
      const del = e.target.closest('[data-del]');
      if (del) { App.docs.remove(del.dataset.del); return; }
      if (Date.now() < noClickUntil) return;
      const mg = e.target.closest('[data-merge]');
      if (mg) { openMerge(mg.dataset.merge); return; }
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
    initStripDrag();
    initMergeDialog();
    initNotes();
    $('#probe-btns').addEventListener('click', e => { const b = e.target.closest('[data-probe]'); if (b) toggleProbe(b.dataset.probe); });
    $('#calib').addEventListener('change', onCalibChange);
    $('#calib').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input')) e.target.blur();   // commit; buttons still activate
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset.vdiv && App.docs.active().kind === 'series') {
        e.preventDefault(); stepSeriesScale(e.target.dataset.vdiv, e.key === 'ArrowUp' ? 1 : -1);
      }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target.dataset.shift) {
        e.preventDefault(); stepShift(App.docs.active(), +e.target.dataset.shift, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      }
    });
    $('#calib').addEventListener('wheel', e => {
      const sh = e.target.closest && e.target.closest('[data-shift]');
      if (sh && e.deltaY) { e.preventDefault(); stepShift(App.docs.active(), +sh.dataset.shift, e.deltaY < 0 ? 1 : -1, e.shiftKey); return; }
      const t = e.target.closest && e.target.closest('[data-vdiv]');
      if (!t || t.disabled || App.docs.active().kind !== 'series' || !e.deltaY) return;
      e.preventDefault(); stepSeriesScale(t.dataset.vdiv, e.deltaY < 0 ? -1 : 1);
    }, { passive: false });
    $('#calib').addEventListener('click', e => {
      const d = App.docs.active(); if (!d) return;
      const id = e.target.id;
      if (id === 'btn-redetect') {
        const series = d.kind === 'series';
        withUndo(d, id, series ? 'Auto scale' : 'Re-detect', () => App.docs.touch(d, 'detect'));
        toast(series ? 'Scales reset to fit the data. Undo is offered for 10 s.' : 'Detection re-run. Undo is offered for 10 s.');
      }
      if (id === 'btn-undo') doUndo();
      if (id.startsWith('btn-align-')) {
        let swapped = false;
        withUndo(d, id, 'Align', () => { swapped = alignAtCursors(d, +id.slice(10)); });
        toast(`Aligned: ${shortName(d.parts[+id.slice(10)].name)} at cursor ${swapped ? 1 : 2} moved onto the reference at cursor ${swapped ? 2 : 1}. Undo is offered for 10 s.`);
      }
      if (id === 'btn-copydisp') copyDisplay(d);
      if (id === 'btn-pastedisp' && copiedDisplay) pasteDisplay(d);
      if (e.target.id === 'btn-pickgrid') { App.view.setMode({ type: 'pick-grid' }); toast('Drag a rectangle over the graticule (outer grid border).'); }
      const ax = e.target.closest('[data-axis]');
      if (ax) { d.axisCh = ax.dataset.axis; App.docs.touch(d, 'calib'); }
      const un = e.target.closest('[data-unit]');
      if (un) flipUnit(d, un.dataset.unit);
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
      if (d !== App.docs.active() || what === 'notes') return;   // typing in the Notes card: nothing to redraw
      renderReadout();
      if (what === 'shift') { syncShifts(d); App.view.render(); return; }   // Ctrl+drag of a curve, many per second
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

  return { init, prefs, renderAll, toast, togglePref, readoutTSV, startRename, askExport, openMerge };
})();
