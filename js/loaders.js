// Input paths: drag & drop (files and folders), clipboard paste, file / folder pickers,
// session import. All roads lead to loadFiles(), which routes images to App.docs.addImage
// and CSV/text waveform exports to App.docs.addSeries.
App.loaders = (() => {
  const IMAGE_RE = /\.(png|jpe?g|bmp|gif|webp)$/i;
  const isImage = f => (f.type && f.type.startsWith('image/')) || IMAGE_RE.test(f.name || '');

  const isSeries = f => !isImage(f) && App.series.isSeriesFile(f);

  /** Load a list of File/Blob objects (images and CSV; others are skipped). Activates the first new doc. */
  async function loadFiles(files) {
    const list = [...files].filter(f => isImage(f) || isSeries(f)).sort((a, b) => App.util.naturalCompare(a.name || '', b.name || ''));
    const skipped = files.length - list.length;
    if (!list.length) { App.events.emit('toast', skipped ? 'No images or CSV files found in the dropped/selected files.' : 'Nothing to load.'); return; }
    App.events.emit('busy', true);
    let first = null;
    try {
      for (const f of list) {
        try {
          const doc = isSeries(f) ? await App.docs.addSeries(f, f.name || 'data.csv') : await App.docs.addImage(f, f.name || 'image');
          // Show the first new image immediately, keep loading the rest in the background.
          if (!first) { first = doc; App.docs.setActive(doc.id); }
        } catch (e) { console.error(e); App.events.emit('toast', `Could not load ${f.name}: ${e.message}`); }
      }
    } finally { App.events.emit('busy', false); }
    if (skipped) App.events.emit('toast', `Skipped ${skipped} file(s) that are neither images nor CSV.`);
  }

  // ---- folders via drag & drop (webkitGetAsEntry works in Chrome, Edge and Firefox)
  // Files get relPath = entry.fullPath ("/folder/file.csv"), so callers can group by folder.
  function readEntry(entry) {
    return new Promise(res => {
      if (entry.isFile) entry.file(f => { f.relPath = entry.fullPath; res([f]); }, () => res([]));
      else if (entry.isDirectory) {
        const reader = entry.createReader(), all = [];
        const next = () => reader.readEntries(async ents => {
          if (!ents.length) { const nested = await Promise.all(all.map(readEntry)); res(nested.flat()); }
          else { all.push(...ents); next(); }
        }, () => res([]));
        next();
      } else res([]);
    });
  }

  async function filesFromDataTransfer(dt) {
    const entries = [...(dt.items || [])].map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) return (await Promise.all(entries.map(readEntry))).flat();
    return [...(dt.files || [])];
  }

  function init({ dropTarget, onDragState }) {
    let depth = 0;
    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    dropTarget.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; onDragState(true); });
    dropTarget.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    dropTarget.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) onDragState(false); });
    dropTarget.addEventListener('drop', async e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; onDragState(false);
      const files = await filesFromDataTransfer(e.dataTransfer);
      const sessions = files.filter(f => /\.json$/i.test(f.name));
      for (const s of sessions) await importSession(s);
      await loadFiles(files.filter(f => !/\.json$/i.test(f.name)));
    });

    // Paste anywhere (except into text inputs): images, or CSV text (e.g. copied from Excel).
    window.addEventListener('paste', e => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const items = [...(e.clipboardData ? e.clipboardData.items : [])].filter(it => it.type.startsWith('image/'));
      if (!items.length) {
        const text = e.clipboardData && e.clipboardData.getData('text/plain');
        if (text && text.split('\n').length > 2) {
          e.preventDefault();
          loadFiles([new File([text], `Pasted ${stamp}.csv`, { type: 'text/csv' })]);
        } else App.events.emit('toast', 'Clipboard contains no image or CSV data.');
        return;
      }
      e.preventDefault();
      const files = items.map((it, i) => {
        const f = it.getAsFile();
        return new File([f], `Pasted ${stamp}${items.length > 1 ? ' #' + (i + 1) : ''}.png`, { type: f.type });
      });
      loadFiles(files);
    });
  }

  /** Open a native picker. kind: 'files' | 'folder' | 'session'. */
  function pick(kind) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (kind === 'files') { inp.multiple = true; inp.accept = 'image/*,.csv,.txt,.tsv,.dat'; }
    if (kind === 'folder') { inp.webkitdirectory = true; inp.multiple = true; }
    if (kind === 'session') inp.accept = '.json,application/json';
    inp.onchange = () => {
      const files = [...inp.files];
      if (kind === 'session') files.forEach(importSession);
      else loadFiles(files);
    };
    inp.click();
  }

  /** Load the built-in demo screenshot(s) from js/demo_image.js (injected on first use). */
  async function loadDemo() {
    if (!App.DEMO_IMAGES) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'js/demo_image.js'; s.onload = res; s.onerror = () => rej(new Error('demo data missing'));
        document.head.appendChild(s);
      }).catch(e => App.events.emit('toast', `Could not load demo: ${e.message}`));
      if (!App.DEMO_IMAGES) return;
    }
    const files = App.DEMO_IMAGES.map(d => {
      const bin = atob(d.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], d.name, { type: d.type });
    });
    await loadFiles(files);
  }

  async function importSession(file) {
    try { await App.docs.importSession(file); App.events.emit('toast', `Imported session ${file.name}`); }
    catch (e) { App.events.emit('toast', `Import failed: ${e.message}`); }
  }

  // ---- shots sent from the DPT page (dpt.html opens this page as a named tab, see js/dpt/app.js)
  // msg = { type: 'scope-open', id, docs: [{ name, notes, csv, names: { C1: header name }, edge: { t1, t2, a, b } | null }] }
  // A shot already in the session (same name) is reused, its notes kept; new ones start with `notes`; edge times are absolute (s):
  // cursors go to t1 / t2 (10 / 90 % crossings), the time window to a..b.
  const handled = new Set();
  async function openHandoff(msg) {
    let first = null;
    for (const it of msg.docs) {
      let doc = App.docs.list().find(d => d.kind === 'series' && d.name === it.name);
      if (!doc) {
        doc = await App.docs.addSeries(new File([it.csv], it.name + '.csv', { type: 'text/csv' }), it.name);
        const named = App.series.autoNames({ cols: Object.entries(it.names || {}).map(([id, name]) => ({ id, name })) });
        for (const id in named) if (doc.series.cols.some(c => c.id === id)) doc.chNames[id] = named[id];
        if (it.notes) doc.userNotes = String(it.notes);
      }
      if (it.edge) {
        const s = doc.series, x = t => (t - s.t0) / s.dt;
        doc.cursors = Object.assign({}, doc.cursors, { x1: x(it.edge.t1), x2: x(it.edge.t2), sel: 1, periods: null });
        doc.view = { xa: x(it.edge.a), xb: x(it.edge.b) };
      }
      App.docs.touch(doc, 'cursors');
      first = first || doc;
    }
    if (first) App.docs.setActive(first.id);
  }
  function initHandoff() {
    if (!window.opener) return;
    window.addEventListener('message', async e => {
      const m = e.data;
      if (e.source !== window.opener || !m || m.type !== 'scope-open' || !Array.isArray(m.docs)) return;
      e.source.postMessage({ type: 'scope-ack', id: m.id }, '*');
      if (handled.has(m.id)) return;
      handled.add(m.id);
      try { await openHandoff(m); } catch (err) { console.error(err); App.events.emit('toast', `Could not open the shot: ${err.message}`); }
    });
    window.opener.postMessage({ type: 'scope-ready' }, '*');
  }

  return { init, initHandoff, pick, loadFiles, loadDemo, readEntry, filesFromDataTransfer };
})();
