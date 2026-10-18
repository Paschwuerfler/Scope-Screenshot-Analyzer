// Input paths: drag & drop (files and folders), clipboard paste, file / folder pickers,
// session import. All roads lead to loadFiles().
App.loaders = (() => {
  const IMAGE_RE = /\.(png|jpe?g|bmp|gif|webp)$/i;
  const isImage = f => (f.type && f.type.startsWith('image/')) || IMAGE_RE.test(f.name || '');

  /** Load a list of File/Blob objects (non-images are skipped). Activates the first new doc. */
  async function loadFiles(files) {
    const list = [...files].filter(isImage).sort((a, b) => App.util.naturalCompare(a.name || '', b.name || ''));
    const skipped = files.length - list.length;
    if (!list.length) { App.events.emit('toast', skipped ? 'No images found in the dropped/selected files.' : 'Nothing to load.'); return; }
    App.events.emit('busy', true);
    let first = null;
    try {
      for (const f of list) {
        try {
          const doc = await App.docs.addImage(f, f.name || 'image');
          // Show the first new image immediately, keep loading the rest in the background.
          if (!first) { first = doc; App.docs.setActive(doc.id); }
        } catch (e) { console.error(e); App.events.emit('toast', `Could not load ${f.name}: ${e.message}`); }
      }
    } finally { App.events.emit('busy', false); }
    if (skipped) App.events.emit('toast', `Skipped ${skipped} non-image file(s).`);
  }

  // ---- folders via drag & drop (webkitGetAsEntry works in Chrome, Edge and Firefox)
  function readEntry(entry) {
    return new Promise(res => {
      if (entry.isFile) entry.file(f => res([f]), () => res([]));
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

    // Paste anywhere (except into text inputs).
    window.addEventListener('paste', e => {
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const items = [...(e.clipboardData ? e.clipboardData.items : [])].filter(it => it.type.startsWith('image/'));
      if (!items.length) { App.events.emit('toast', 'Clipboard contains no image.'); return; }
      e.preventDefault();
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
    if (kind === 'files') { inp.multiple = true; inp.accept = 'image/*'; }
    if (kind === 'folder') { inp.webkitdirectory = true; inp.multiple = true; }
    if (kind === 'session') inp.accept = '.json,application/json';
    inp.onchange = () => {
      const files = [...inp.files];
      if (kind === 'session') files.forEach(importSession);
      else loadFiles(files);
    };
    inp.click();
  }

  async function importSession(file) {
    try { await App.docs.importSession(file); App.events.emit('toast', `Imported session ${file.name}`); }
    catch (e) { App.events.emit('toast', `Import failed: ${e.message}`); }
  }

  return { init, pick, loadFiles };
})();
