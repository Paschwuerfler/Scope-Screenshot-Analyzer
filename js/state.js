// Documents (= loaded screenshots) and persistence.
//
// A doc has persisted fields (saved to IndexedDB, exported in sessions):
//   { id, name, kind: 'image' | 'series', blob, width, height, addedAt,   // series: blob = CSV text or packed samples, see js/series.js
//     layoutId, layoutName,             // null = unknown layout (manual calibration)
//     calib, status, notes, raw,        // see js/calibrate.js; status values 'ok'|'warn'|'manual'
//     chNames: { C1: 'Vout', ... },     // optional custom channel names (App.calib.chLabel)
//     axisCh,                           // series: channel labelling the y axis (App.series.axisChannel)
//     cursors: { x1, x2, sel, periods } } // cursor x positions in image px, sel = 1|2 (keyboard target),
//                                       // periods = multi-period mode {p0, x1} or null (js/measure.js)
// and runtime-only fields (rebuilt on load, never saved):
//   { bitmap, imgData, traces, thumbUrl }  or for series { series, thumbUrl }
//
// Modules never mutate docs silently: call App.docs.update(doc, changes) or
// App.docs.touch(doc) afterwards so views re-render and the doc is saved.
App.store = (() => {
  const DB_NAME = 'scope-screenshot-analyzer', DB_VERSION = 1;
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB not available'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('database blocked by another tab'));
      // Some environments (locked-down profiles, some private modes) never answer.
      setTimeout(() => rej(new Error('IndexedDB did not respond')), 4000);
    });
    return dbp;
  }
  const tx = async (store, mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => res(r && r.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    putDoc: rec => tx('docs', 'readwrite', s => s.put(rec)),
    deleteDoc: id => tx('docs', 'readwrite', s => s.delete(id)),
    allDocs: () => tx('docs', 'readonly', s => s.getAll()),
    clearAll: async () => { await tx('docs', 'readwrite', s => s.clear()); await tx('meta', 'readwrite', s => s.clear()); },
    putMeta: (key, val) => tx('meta', 'readwrite', s => s.put(val, key)),
    getMeta: key => tx('meta', 'readonly', s => s.get(key)),
  };
})();

App.docs = (() => {
  const PERSISTED = ['id', 'name', 'kind', 'blob', 'width', 'height', 'addedAt', 'layoutId', 'layoutName', 'calib', 'status', 'notes', 'raw', 'chNames', 'axisCh', 'cursors'];
  const docs = [];
  let activeId = null;
  let persistenceOk = true;

  const serialize = doc => Object.fromEntries(PERSISTED.map(k => [k, doc[k]]));

  // ---- saving (debounced per doc)
  const pending = new Set();
  const flush = App.util.debounce(async () => {
    const ids = [...pending]; pending.clear();
    try {
      for (const id of ids) { const d = get(id); if (d) await App.store.putDoc(serialize(d)); }
      await App.store.putMeta('session', { order: docs.map(d => d.id), activeId, ui: App.ui ? App.ui.prefs : undefined });
    } catch (e) { reportPersistError(e); }
  }, 400);
  function save(doc) { if (doc) pending.add(doc.id); flush(); }
  function reportPersistError(e) {
    if (persistenceOk) { persistenceOk = false; console.warn('Persistence disabled:', e); App.events.emit('toast', 'Session cannot be saved in this browser (' + e.message + '). Use Export instead.'); }
  }

  // ---- queries
  const get = id => docs.find(d => d.id === id) || null;
  const active = () => get(activeId);
  const list = () => docs;

  // ---- image decoding + analysis
  async function decode(blob) {
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
    return { bitmap, imgData: ctx.getImageData(0, 0, bitmap.width, bitmap.height) };
  }

  /** Run layout detection + calibration on a doc (overwrites calib/status/notes). Series: auto scale. */
  function analyze(doc) {
    if (doc.kind === 'series') {
      const s = doc.series, { calib, status } = App.series.autoCalib(s);
      // Auto scale keeps a unit the user switched (V <-> A)
      if (doc.calib) for (const id in calib.channels) if (doc.calib.channels[id]) calib.channels[id].unit = doc.calib.channels[id].unit;
      const span = App.util.formatSI((s.n - 1) * s.dt, 's');
      Object.assign(doc, {
        layoutId: 'csv', layoutName: `CSV · ${s.n.toLocaleString('en')} samples · ${span}`, calib, status, raw: {},
        notes: [...s.notes, `Columns: ${s.cols.map(c => `${c.name} [${c.unit}] → ${c.id}`).join(', ')}.`],
      });
      return;
    }
    const det = App.layouts.detect(doc.imgData);
    if (det.layout) {
      const r = det.layout.analyze(doc.imgData);
      Object.assign(doc, { layoutId: det.layout.id, layoutName: det.layout.name, calib: r.calib, status: r.status, notes: r.notes, raw: r.raw });
    } else {
      Object.assign(doc, {
        layoutId: null, layoutName: 'Unknown layout', calib: App.calib.emptyCalib(doc.width, doc.height),
        status: { time: { tdiv: 'manual', tCenter: 'manual' }, channels: {}, grid: 'manual' },
        notes: ['Layout not recognised — set the graticule ("Pick grid") and scales manually.'], raw: {},
      });
    }
  }

  function retrace(doc) { doc.traces = doc.kind === 'series' ? null : App.traces.extract(doc.imgData, doc.calib); }

  /** Rebuild runtime fields (bitmap/traces or parsed series, thumbnail) of a persisted record. */
  async function hydrate(rec, blob = rec.blob) {
    if (rec.kind === 'series') {
      const doc = { ...rec, blob, series: await App.series.load(blob) };
      if (!doc.chNames) doc.chNames = App.series.autoNames(doc.series);   // saved before names existed
      doc.thumbUrl = await App.series.thumbnail(doc);
      return doc;
    }
    const doc = { ...rec, blob, ...(await decode(blob)) };
    retrace(doc);
    doc.thumbUrl = URL.createObjectURL(blob);
    return doc;
  }

  function defaultCursors(doc) {
    const g = doc.calib.grid, w = g.right - g.left;
    return { x1: g.left + w * 0.4, x2: g.left + w * 0.6, sel: 1 };
  }

  /** Add an image (Blob/File). Returns the doc. */
  async function addImage(blob, name) {
    const { bitmap, imgData } = await decode(blob);
    const doc = { id: App.util.uid(), name: name || 'image', kind: 'image', blob, width: bitmap.width, height: bitmap.height, addedAt: Date.now(), bitmap, imgData };
    analyze(doc);
    retrace(doc);
    doc.cursors = defaultCursors(doc);
    doc.thumbUrl = URL.createObjectURL(blob);
    docs.push(doc);
    save(doc);
    App.events.emit('docs-changed');
    return doc;
  }

  /** Add a time-series file (CSV text as Blob/File). Returns the doc. */
  async function addSeries(blob, name) {
    const series = App.series.parse(await App.series.readText(blob));
    const doc = { id: App.util.uid(), name: name || 'data.csv', kind: 'series', blob, width: series.n, height: App.series.VH, addedAt: Date.now(), series, chNames: App.series.autoNames(series) };
    analyze(doc);
    retrace(doc);
    doc.cursors = defaultCursors(doc);
    doc.thumbUrl = await App.series.thumbnail(doc);
    docs.push(doc);
    save(doc);
    App.events.emit('docs-changed');
    return doc;
  }

  /** Restore persisted docs on startup. */
  async function restore() {
    let recs = [], meta = null;
    try { recs = await App.store.allDocs(); meta = await App.store.getMeta('session'); }
    catch (e) { reportPersistError(e); return; }
    const order = (meta && meta.order) || [];
    recs.sort((a, b) => (order.indexOf(a.id) + 1 || 1e9) - (order.indexOf(b.id) + 1 || 1e9) || a.addedAt - b.addedAt);
    for (const rec of recs) {
      try { docs.push(await hydrate(rec)); } catch (e) { console.warn('could not restore', rec.name, e); }
    }
    if (meta && meta.ui && App.ui) Object.assign(App.ui.prefs, meta.ui);
    activeId = meta && get(meta.activeId) ? meta.activeId : (docs[0] ? docs[0].id : null);
    App.events.emit('docs-changed');
    App.events.emit('active-changed');
  }

  function setActive(id) {
    if (id === activeId || !get(id)) return;
    activeId = id; save(null);
    App.events.emit('active-changed');
  }

  function step(delta) {
    if (!docs.length) return;
    const i = Math.max(0, docs.findIndex(d => d.id === activeId));
    setActive(docs[App.util.clamp(i + delta, 0, docs.length - 1)].id);
  }

  async function remove(id) {
    const i = docs.findIndex(d => d.id === id);
    if (i < 0) return;
    const [d] = docs.splice(i, 1);
    if (d.thumbUrl) URL.revokeObjectURL(d.thumbUrl);
    if (activeId === id) activeId = docs[Math.min(i, docs.length - 1)] ? docs[Math.min(i, docs.length - 1)].id : null;
    try { await App.store.deleteDoc(id); } catch (e) { reportPersistError(e); }
    save(null);
    App.events.emit('docs-changed');
    App.events.emit('active-changed');
  }

  function rename(id, name) {
    const d = get(id), n = String(name || '').trim();
    if (!d || !n || n === d.name) return;
    d.name = n; save(d);
    App.events.emit('docs-changed');
  }

  async function clear() {
    docs.splice(0).forEach(d => d.thumbUrl && URL.revokeObjectURL(d.thumbUrl));
    activeId = null;
    try { await App.store.clearAll(); } catch (e) { reportPersistError(e); }
    App.events.emit('docs-changed');
    App.events.emit('active-changed');
  }

  /**
   * Notify that a doc changed. `what` hints what to recompute:
   *   'cursors' -> just re-render; 'calib' -> re-extract traces; 'detect' -> full re-analysis.
   */
  function touch(doc, what = 'cursors') {
    if (what === 'detect') { analyze(doc); retrace(doc); }
    else if (what === 'calib') retrace(doc);
    save(doc);
    App.events.emit('doc-updated', doc, what);
  }

  // ---- export / import (portable JSON with embedded images and CSVs as data URLs)
  const blobToDataUrl = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  /**
   * mode 'exact': stored files as they are; 'lossless' / 'compact': CSV docs packed as
   * float32 / 16-bit (App.series.pack). -> { blob, lossy: [{ name, note }] } (docs newly stored at 16 bit).
   */
  async function exportSession(mode = 'exact') {
    const out = { app: 'scope-screenshot-analyzer', version: 1, exportedAt: new Date().toISOString(), docs: [] }, lossy = [];
    for (const d of docs) {
      const rec = serialize(d);
      let blob = d.blob;
      const enc = d.kind === 'series' ? App.series.packedEnc(blob) : null, want = { lossless: 'f32', compact: 'q16' }[mode];
      // already 16 bit: keep (unpacking to float32 would only be bigger)
      if (d.kind === 'series' && want && enc !== want && enc !== 'q16') {
        const p = await App.series.pack(d.series, want, d.calib.channels);
        blob = p.blob;
        if (p.note) { rec.notes = [p.note, ...(d.notes || []).filter(n => !App.series.isPrecisionNote(n))]; lossy.push({ name: d.name, note: p.note }); }
      }
      if (App.series.packedEnc(blob)) out.version = 2;   // older app versions cannot read packed series
      rec.blob = await blobToDataUrl(blob); out.docs.push(rec);
    }
    return { blob: new Blob([JSON.stringify(out)], { type: 'application/json' }), lossy };
  }
  async function importSession(file) {
    const data = JSON.parse(await file.text());
    if (data.app !== 'scope-screenshot-analyzer') throw new Error('Not a session file');
    let first = null;
    for (const rec of data.docs) {
      const blob = await (await fetch(rec.blob)).blob();
      const doc = await hydrate({ ...rec, id: App.util.uid() }, blob);
      docs.push(doc); save(doc);
      first = first || doc;
    }
    App.events.emit('docs-changed');
    if (first) setActive(first.id);
  }

  return { list, get, active, setActive, step, addImage, addSeries, restore, remove, rename, clear, touch, analyze, exportSession, importSession, isPersistent: () => persistenceOk };
})();
