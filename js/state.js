// Documents (= loaded screenshots) and persistence.
//
// A doc has persisted fields (saved to IndexedDB, exported in sessions):
//   { id, name, kind: 'image' | 'series', blob, width, height, addedAt,   // series: blob = CSV text or packed samples, see js/series.js
//     layoutId, layoutName,             // null = unknown layout (manual calibration)
//     calib, status, notes, raw,        // see js/calibrate.js; status values 'ok'|'warn'|'manual'
//     chNames: { C1: 'Vout', ... },     // optional custom channel names (App.calib.chLabel)
//     axisCh,                           // series: channel labelling the y axis (App.series.axisChannel)
//     cursors: { x1, x2, sel, periods }, // cursor x positions in image px, sel = 1|2 (keyboard target),
//                                       // periods = multi-period mode {p0, x1} or null (js/measure.js)
//     userNotes,                        // free text typed by the user (Notes card), '' if none
//     parts }                           // merged views only (blob = null): [{ name, blob, shift, map }],
//                                       // see addMerged / App.series.combine
// and runtime-only fields (rebuilt on load, never saved):
//   { bitmap, imgData, traces, thumbUrl }  or for series { series, thumbUrl } (+ partData for merged views)
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
  const PERSISTED = ['id', 'name', 'kind', 'blob', 'width', 'height', 'addedAt', 'layoutId', 'layoutName', 'calib', 'status', 'notes', 'raw', 'chNames', 'axisCh', 'cursors', 'parts', 'userNotes'];
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
  // Transparent pixels are flattened onto white, so screenshots (e.g. pasted PNGs with
  // transparent margins) look the same everywhere and analysis never sees "black" alpha=0 pixels.
  async function decode(blob) {
    let bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    let imgData = ctx.getImageData(0, 0, c.width, c.height);
    let opaque = true;
    for (let i = 3; i < imgData.data.length; i += 4) if (imgData.data[i] !== 255) { opaque = false; break; }
    if (!opaque) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bitmap, 0, 0);
      bitmap.close(); bitmap = await createImageBitmap(c);
      imgData = ctx.getImageData(0, 0, c.width, c.height);
    }
    return { bitmap, imgData };
  }

  /** Run layout detection + calibration on a doc (overwrites calib/status/notes). Series: auto scale. */
  function analyze(doc) {
    if (doc.kind === 'series') {
      const s = doc.series, { calib, status } = App.series.autoCalib(s);
      // Auto scale keeps a unit the user switched (V <-> A)
      if (doc.calib) for (const id in calib.channels) if (doc.calib.channels[id]) calib.channels[id].unit = doc.calib.channels[id].unit;
      const span = App.util.formatSI((s.n - 1) * s.dt, 's');
      const cols = s.cols.map(c => `${doc.parts ? doc.parts[c.part].name + ': ' : ''}${c.name} [${c.unit}] → ${c.id}`);
      Object.assign(doc, {
        layoutId: 'csv', calib, status, raw: {},
        layoutName: doc.parts ? `Merged · ${doc.parts.length} recordings · ${span}` : `CSV · ${s.n.toLocaleString('en')} samples · ${span}`,
        notes: [...s.notes, `Columns: ${cols.join(', ')}.`],
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
    if (rec.kind === 'series' && rec.parts) {
      const doc = { ...rec, blob: null, partData: await Promise.all(rec.parts.map(p => App.series.load(p.blob))) };
      doc.series = App.series.combine(doc.parts, doc.partData);
      doc.width = doc.series.n;
      doc.thumbUrl = await App.series.thumbnail(doc);
      return doc;
    }
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

  /**
   * Add a merged view (several CSV recordings in one plot) after doc afterId. parts = [{ name, blob,
   * shift, map }], data = their parsed series (same order), setup = { chNames, channels: { C1: {on,
   * vdiv, zeroY, unit} }, t1, t2, tA, tB } (cursor times and visible window in s). Returns the doc.
   */
  async function addMerged(name, parts, data, setup, afterId) {
    const series = App.series.combine(parts, data);
    const doc = { id: App.util.uid(), name, kind: 'series', blob: null, width: series.n, height: App.series.VH, addedAt: Date.now(), parts, partData: data, series, chNames: setup.chNames };
    analyze(doc);
    for (const id in setup.channels) if (doc.calib.channels[id]) Object.assign(doc.calib.channels[id], setup.channels[id]);
    const x = t => App.util.clamp((t - series.t0) / series.dt, 0, series.n - 1);
    doc.cursors = { x1: x(setup.t1), x2: x(setup.t2), sel: 1, periods: null };
    doc.view = { xa: x(setup.tA), xb: x(setup.tB) };
    retrace(doc);
    doc.thumbUrl = await App.series.thumbnail(doc);
    const i = docs.findIndex(d => d.id === afterId);
    docs.splice(i < 0 ? docs.length : i + 1, 0, doc);
    save(doc);
    App.events.emit('docs-changed');
    return doc;
  }

  /**
   * Merged views: rebuild the time grid after a part's shift changed. Cursors, multi-period marks and
   * the visible window keep their times. final = done (drag ended / value typed): new thumbnail, save.
   */
  function remerge(doc, final = false) {
    const old = doc.series, s = App.series.combine(doc.parts, doc.partData), c = doc.calib;
    const re = x => (old.t0 + x * old.dt - s.t0) / s.dt;
    doc.series = s; doc.width = s.n;
    c.grid.right = s.n - 1;
    c.time = { tdiv: (s.n - 1) * s.dt / 10, tCenter: s.t0 + (s.n - 1) * s.dt / 2 };
    const cur = doc.cursors, clampX = x => App.util.clamp(re(x), 0, s.n - 1);
    cur.x1 = clampX(cur.x1); cur.x2 = clampX(cur.x2);
    if (cur.periods) cur.periods = { p0: cur.periods.p0 * old.dt / s.dt, x1: re(cur.periods.x1) };
    if (doc.view) doc.view = { xa: re(doc.view.xa), xb: re(doc.view.xb) };
    if (!final) return;
    touch(doc, 'calib');
    App.series.thumbnail(doc).then(url => {
      if (doc.thumbUrl) URL.revokeObjectURL(doc.thumbUrl);
      doc.thumbUrl = url;
      App.events.emit('docs-changed');
    });
  }

  /** Stored data blobs of a doc (one, or one per part of a merged view). */
  const blobsOf = d => (d.parts ? d.parts.map(p => p.blob) : [d.blob]);

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
   *   'cursors' -> just re-render; 'notes' -> only save; 'calib' -> re-extract traces; 'detect' -> full re-analysis.
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
    const want = { lossless: 'f32', compact: 'q16' }[mode];
    // one stored file -> data URL, packed if asked (already 16 bit: kept, unpacking to float32 would only be bigger)
    // -> { url, note } (note: 16-bit error text, if newly packed)
    const encode = async (blob, series, channels, name) => {
      let note = null;
      if (series && want && App.series.packedEnc(blob) !== want && App.series.packedEnc(blob) !== 'q16') {
        const p = await App.series.pack(series, want, channels);
        blob = p.blob; note = p.note;
        if (note) lossy.push({ name, note });
      }
      if (App.series.packedEnc(blob)) out.version = 2;   // older app versions cannot read packed series
      return { url: await blobToDataUrl(blob), note };
    };
    for (const d of docs) {
      const rec = serialize(d), series = d.kind === 'series';
      let notes = [];
      if (d.parts) {   // merged view: each recording stored on its own
        rec.parts = [];
        for (const [k, p] of d.parts.entries()) {
          const e = await encode(p.blob, d.partData[k], {}, `${d.name} / ${p.name}`);
          rec.parts.push({ ...p, blob: e.url });
          if (e.note) notes.push(`${p.name}: ${e.note}`);
        }
      } else {
        const e = await encode(d.blob, series ? d.series : null, d.calib.channels, d.name);
        rec.blob = e.url;
        if (e.note) notes = [e.note];
      }
      if (notes.length) rec.notes = [...notes, ...(d.notes || []).filter(n => !App.series.isPrecisionNote(n.replace(/^[^:]*: /, '')))];
      out.docs.push(rec);
    }
    return { blob: new Blob([JSON.stringify(out)], { type: 'application/json' }), lossy };
  }
  async function importSession(file) {
    const data = JSON.parse(await file.text());
    if (data.app !== 'scope-screenshot-analyzer') throw new Error('Not a session file');
    let first = null;
    const fromUrl = async url => (await fetch(url)).blob();
    for (const rec of data.docs) {
      const parts = rec.parts && await Promise.all(rec.parts.map(async p => ({ ...p, blob: await fromUrl(p.blob) })));
      const doc = parts ? await hydrate({ ...rec, parts, id: App.util.uid() }) : await hydrate({ ...rec, id: App.util.uid() }, await fromUrl(rec.blob));
      docs.push(doc); save(doc);
      first = first || doc;
    }
    App.events.emit('docs-changed');
    if (first) setActive(first.id);
  }

  return { list, get, active, setActive, step, addImage, addSeries, addMerged, remerge, blobsOf, restore, remove, rename, clear, touch, analyze, exportSession, importSession, isPersistent: () => persistenceOk };
})();
