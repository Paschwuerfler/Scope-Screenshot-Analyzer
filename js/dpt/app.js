// DPT page bootstrap: toolbar actions, folder drop / pickers (one batch per folder), pool
// import / export, keyboard shortcuts. Shortcuts are listed in KEYS and in the help dialog.
App.dpt.app = (() => {
  const $ = s => document.querySelector(s);
  const ui = App.dpt.ui, pool = App.dpt.pool;
  let queue = Promise.resolve();

  /** Group files by the folder they came from (relPath from a drop, webkitRelativePath from the picker). */
  function byFolder(files) {
    const groups = new Map();
    for (const f of files) {
      const parts = (f.relPath || f.webkitRelativePath || '').split('/').filter(Boolean);
      const dir = parts.slice(0, -1).join('/');
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(f);
    }
    return [...groups].map(([dir, fl]) => ({ folder: dir.split('/').pop() || '', files: fl }));
  }

  /** Add files as batches, one dialog per folder, one after another. */
  function addFiles(files, folder) {
    const groups = folder !== undefined ? [{ folder, files: [...files] }] : byFolder([...files]);
    queue = queue.then(async () => {
      for (const g of groups) {
        const d = await pool.draft(g.files, g.folder);
        if (!d.shots.length) { ui.toast(`No CSV files found${g.folder ? ' in ' + g.folder : ''}.`); continue; }
        await ui.openBatchDialog({ draft: d });
      }
    }).catch(e => { console.error(e); ui.toast(`Could not add: ${e.message}`); });
    return queue;
  }

  function pick(kind) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    if (kind === 'folder') inp.webkitdirectory = true;
    else if (kind === 'pool') { inp.multiple = false; inp.accept = '.json,application/json'; }
    else inp.accept = '.csv,.txt,.tsv,.dat';
    inp.onchange = () => {
      const files = [...inp.files];
      if (kind === 'pool') importPool(files[0]);
      else if (files.length) addFiles(files, kind === 'files' ? '' : undefined);
    };
    inp.click();
  }

  function download(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  async function importPool(file) {
    try {
      const warn = await pool.importJson(await file.text());
      ui.toast(warn.length ? `Imported ${file.name}. ! ${warn.join(' · ')}` : `Imported ${file.name}`, warn.length ? 12000 : undefined);
    }
    catch (e) { ui.toast(`Import failed: ${e.message}`); }
  }

  async function copyCanvas(sel) {
    try {
      const blob = await new Promise(res => $(sel).toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      ui.toast('Plot copied as image.');
    } catch (e) { ui.toast(`Copy failed: ${e.message}`); }
  }
  async function copyTable() {
    try { await navigator.clipboard.writeText(ui.tableText('\t')); ui.toast('Table copied (tab-separated).'); }
    catch (e) { ui.toast(`Copy failed: ${e.message}`); }
  }

  // ---------------------------------------------------------------- open shots in the analyzer
  // The analyzer runs in a named tab (reused). Shots go over postMessage, which works between
  // file:// pages; the analyzer answers 'scope-ready' once loaded and 'scope-ack' per payload.
  const SCOPE_WIN = 'scope-analyzer';
  let handoff = null;   // { win, msg } until acknowledged

  /** CSV text of one shot with all channels (one time column), or null if they are not sampled alike. */
  function shotCsv(sh) {
    const ids = Object.keys(sh.cols).sort(), c = ids.map(id => sh.cols[id]), a = c[0];
    if (!a || c.some(x => x.v.length !== a.v.length || Math.abs(x.dt - a.dt) > 1e-6 * a.dt || Math.abs(x.t0 - a.t0) > 0.5 * a.dt)) return null;
    const lines = [['Time in s', ...ids.map((id, k) => `${id} in ${c[k].unit}`)].join(',')];
    for (let i = 0; i < a.v.length; i++) lines.push([(a.t0 + i * a.dt).toPrecision(9), ...c.map(x => x.v[i].toPrecision(7))].join(','));
    return lines.join('\n');
  }

  /**
   * Name and notes of a shot in the analyzer: values only in the name, values first so they stay
   * visible in the thumbnail ("S20 · 10 Ω · 24 V · 32.4 A (NOR45A24_Rg10_24V)"); keys in the notes.
   */
  function scopeLabel(sh) {
    const b = pool.batchOf(sh), fmt = p => p.value !== null ? App.util.formatSI(p.value, p.unit, 4) : p.text;
    const params = b.params.filter(p => p.key), I = pool.shotCurrent(sh);
    const Itext = I === null || I === undefined ? '–' : App.util.formatSI(I, 'A', 3) + (sh.current !== null && sh.current !== undefined ? ' (entered)' : '');
    return {
      name: [sh.label, ...params.map(fmt), Itext].join(' · ') + ` (${b.name})`,
      notes: [`DPT shot ${sh.label} · folder ${b.name}`, ...params.map(p => `${p.key} = ${fmt(p)}`), `I = ${Itext}`].join('\n'),
    };
  }

  /** One analyzer doc per shot (per file if its channels differ in sampling), with the selected edge to zoom to. */
  function scopeDocs(sh) {
    const { name, notes } = scopeLabel(sh), ek = ui.prefs.edge;
    const e = sh.res && (sh.res.edges.find(x => x.kind + x.n === ek) || (!ek && sh.res.edges[0]));
    const w = ui.overlayWindow();
    const edge = e ? { t1: e.t10 ?? e.t50, t2: e.t90 ?? e.t50, a: e.t50 + w.a, b: e.t50 + w.b } : null;
    const names = Object.fromEntries(Object.entries(sh.cols).map(([id, c]) => [id, c.name]));
    const csv = shotCsv(sh);
    if (csv) return [{ name, notes, csv, names, edge }];
    return sh.files.map(f => ({ name: `${name} · ${f.name}`, notes, csv: f.text, names: {}, edge }));
  }

  /**
   * One analyzer doc with the switch node of up to 4 shots (repeats of one trend point) as C1..C4, no
   * current. Time axis = the first shot's; the others are shifted so their 50 % crossings of the selected
   * edge coincide with it, interpolated onto its grid and cut to the span all of them cover.
   */
  function overlayDoc(shots) {
    const ek = ui.prefs.edge, edgeOf = sh => sh.res && sh.res.edges.find(x => x.kind + x.n === ek);
    const cols = shots.map(sh => sh.cols[pool.batchOf(sh).roles.sw]);
    if (cols.some(c => !c)) return null;
    const e0 = edgeOf(shots[0]), t50 = shots.map(sh => (edgeOf(sh) || e0 || { t50: 0 }).t50), a = cols[0];
    const shift = shots.map((sh, k) => t50[k] - t50[0]);   // shot k at time t of shot 0 = its own time t + shift
    const valueAt = (c, t) => { const x = (t - c.t0) / c.dt, i = Math.floor(x); return i < 0 || i >= c.v.length - 1 ? null : c.v[i] + (c.v[i + 1] - c.v[i]) * (x - i); };
    const lines = [['Time in s', ...cols.map((c, k) => `C${k + 1} in ${c.unit || 'V'}`)].join(',')];
    for (let i = 0; i < a.v.length; i++) {
      const t = a.t0 + i * a.dt, vs = cols.map((c, k) => k ? valueAt(c, t + shift[k]) : c.v[i]);
      if (vs.every(v => v !== null)) lines.push([t.toPrecision(9), ...vs.map(v => v.toPrecision(7))].join(','));
    }
    if (lines.length < 3) return null;
    const b0 = pool.batchOf(shots[0]), fmt = p => p.value !== null ? App.util.formatSI(p.value, p.unit, 4) : p.text;
    const params = b0.params.filter(p => p.key), w = ui.overlayWindow(), folders = shots.map(sh => pool.batchOf(sh).name);
    const name = [shots[0].label, ...params.map(fmt), `${shots.length} runs`].join(' · ') + ` (switch node, ${ek || 'no edge'})`;
    return {
      name, csv: lines.join('\n'),
      names: Object.fromEntries(folders.map((f, k) => [`C${k + 1}`, f])),
      notes: [`DPT shot ${shots[0].label}: switch node of ${shots.length} runs, aligned at the 50 % crossing of ${ek || 'the record start'}`,
        ...params.map(p => `${p.key} = ${fmt(p)}`), ...shots.map((sh, k) => `C${k + 1} = ${folders[k]} (I = ${App.util.formatSI(pool.shotCurrent(sh), 'A', 3)})`)].join('\n'),
      edge: e0 ? { t1: e0.t10 ?? e0.t50, t2: e0.t90 ?? e0.t50, a: e0.t50 + w.a, b: e0.t50 + w.b } : null,
    };
  }

  /** ids: shots to open, one analyzer image each; together: their switch nodes in one plot (overlayDoc). */
  function openInScope(ids, together = false) {
    let shots = ids.map(id => pool.shots.find(s => s.id === id)).filter(Boolean);
    if (!shots.length) { ui.toast('Hover or pin a shot first.'); return; }
    if (together && shots.length > 4) { ui.toast(`A scope view has 4 channels: showing the first 4 of ${shots.length} runs.`); shots = shots.slice(0, 4); }
    const one = together ? overlayDoc(shots) : null;
    if (together && !one) { ui.toast('These shots have no common time span to show together.'); return; }
    const msg = { type: 'scope-open', id: App.util.uid(), docs: one ? [one] : shots.flatMap(scopeDocs) };
    let win = window.open('', SCOPE_WIN), loaded = true;
    if (!win) { ui.toast('The browser blocked opening the analyzer tab. Allow pop-ups for this page.'); return; }
    // a fresh named window is about:blank (readable); an existing analyzer tab may be unreadable on file://
    try { loaded = /index\.html/.test(win.location.href); } catch (e) { /* other origin = analyzer */ }
    if (!loaded) win.location.href = 'index.html';
    handoff = { win, msg };
    if (loaded) win.postMessage(msg, '*');
    win.focus();
    ui.toast(`Opening ${one ? `${shots.length} runs of ${shots[0].label} in one plot` : shots.length > 1 ? shots.length + " shots" : shots[0].label} in the scope view…`);
  }
  window.addEventListener('message', e => {
    if (!handoff || e.source !== handoff.win || !e.data) return;
    if (e.data.type === 'scope-ready') handoff.win.postMessage(handoff.msg, '*');
    else if (e.data.type === 'scope-ack' && e.data.id === handoff.msg.id) handoff = null;
  });

  const ACTIONS = {
    'add-folder': () => pick('folder'),
    'add-files': () => pick('files'),
    export: () => download(pool.exportJson(), `dpt-pool-${stamp()}.json`, 'application/json'),
    import: () => pick('pool'),
    clear: () => { if (pool.shots.length && confirm('Remove all folders from the pool?')) pool.clear(); },
    help: () => $('#help').showModal(),
    close: e => e.target.closest('dialog').close(),
    fit: () => ui.fitOverlay(),
    'copy-overlay': () => copyCanvas('#cv-overlay'),
    'copy-trend': () => copyCanvas('#cv-trend'),
    'copy-table': copyTable,
    'export-csv': () => download(ui.tableText(','), `dpt-edges-${stamp()}.csv`, 'text/csv'),
  };

  const KEYS = {
    a: () => pick('folder'),
    e: () => ui.cycleEdge(1),
    E: () => ui.cycleEdge(-1),
    f: () => ui.fitOverlay(),
    l: () => $('#tgl-logx').click(),
    c: copyTable,
    '/': () => ui.focusFilter(),
    o: () => openInScope(ui.keyShots()),
    h: () => ui.hideKeyShots(),
    H: () => ui.unhideAll(),
    '+': () => ui.zoomOverlay(0.8), '=': () => ui.zoomOverlay(0.8), '-': () => ui.zoomOverlay(1.25),
    ArrowLeft: () => ui.panOverlay(-0.1), ArrowRight: () => ui.panOverlay(0.1),
    Escape: () => ui.unpinAll(),
    '?': () => $('#help').showModal(),
  };

  function initDrop() {
    let depth = 0;
    const has = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const set = on => document.body.classList.toggle('dragging', on);
    window.addEventListener('dragenter', e => { if (!has(e)) return; e.preventDefault(); depth++; set(true); });
    window.addEventListener('dragover', e => { if (!has(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', e => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) set(false); });
    window.addEventListener('drop', async e => {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; set(false);
      const files = await App.loaders.filesFromDataTransfer(e.dataTransfer);
      const json = files.filter(f => /\.json$/i.test(f.name));
      for (const f of json) await importPool(f);
      const rest = files.filter(f => !/\.json$/i.test(f.name));
      if (rest.length) addFiles(rest);
    });
  }

  async function init() {
    ui.init();
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && ACTIONS[b.dataset.act]) ACTIONS[b.dataset.act](e);
    });
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input, textarea, select, dialog[open]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const fn = KEYS[e.key];
      if (fn) { e.preventDefault(); fn(); }
    });
    initDrop();
    await pool.restore();
    document.body.dataset.ready = '1';
  }

  init();
  return { addFiles, byFolder, openInScope, shotCsv, scopeLabel, overlayDoc };
})();
