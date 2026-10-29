// DPT pool: all shots of all loaded folders ("batches"), their parameters and the derived
// metrics. Persisted in its own IndexedDB (separate from the analyzer's session).
//
// batch = { id, name, params: [{ key, text, value (SI number or null), unit }], roles: { sw, cur }, added }
// shot  = { id, batchId, label, files: [{ name, text }], current (override, A) | null, hidden }
// Runtime only (never stored): shot.cols (parsed channels by id), shot.res (App.dpt.edges.analyze).
App.dpt.pool = (() => {
  const DB_NAME = 'scope-dpt-pool', DB_VERSION = 1;
  const SHOT_RE = /^(.*?)[_\- ]?(?:C|CH)([1-4])\.(csv|txt|tsv|dat)$/i;
  let batches = [], shots = [], settings = Object.assign({}, App.dpt.edges.DEFAULTS);
  let dbp = null;

  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('batches', { keyPath: 'id' });
        req.result.createObjectStore('shots', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), r = fn(t.objectStore(store));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  }
  const strip = sh => ({ id: sh.id, batchId: sh.batchId, label: sh.label, files: sh.files, current: sh.current, hidden: !!sh.hidden });
  const putShots = list => tx('shots', 'readwrite', st => { for (const sh of list) st.put(strip(sh)); }).catch(report);
  const putBatch = b => tx('batches', 'readwrite', st => st.put(b)).catch(report);
  function report(e) { console.error(e); App.events.emit('toast', `Could not save the pool in this browser: ${e.message}`); }

  // ---------------------------------------------------------------- parsing / analysis
  /** Parse the shot's files into channels. A one-column file named "..._C3.csv" is C3 whatever its header says. */
  function parseShot(sh) {
    sh.cols = {}; sh.notes = [];
    for (const f of sh.files) {
      try {
        const s = App.series.parse(f.text), m = f.name.match(SHOT_RE);
        for (const c of s.cols) {
          const id = m && s.cols.length === 1 ? 'C' + m[2] : c.id;
          if (!sh.cols[id]) sh.cols[id] = { t0: s.t0, dt: s.dt, v: c.v, unit: c.unit, name: c.name, file: f.name };
        }
      } catch (e) { sh.notes.push(`${f.name}: ${e.message}`); }
    }
  }
  function analyzeShot(sh, roles) {
    if (!sh.cols) parseShot(sh);
    const sw = sh.cols[roles.sw], cur = sh.cols[roles.cur] || null;
    sh.res = sw ? App.dpt.edges.analyze(sw, cur, settings) : { edges: [], iMean: null, warn: [`no channel ${roles.sw} in this shot`] };
    if (sh.notes.length) sh.res.warn.push(...sh.notes);
  }
  const batchOf = sh => batches.find(b => b.id === sh.batchId);
  function reanalyze() { for (const sh of shots) analyzeShot(sh, batchOf(sh).roles); App.events.emit('pool-changed'); }
  function setSettings(s) { settings = Object.assign({}, App.dpt.edges.DEFAULTS, s); reanalyze(); }

  // ---------------------------------------------------------------- folder -> draft batch
  /**
   * Turn the files of one folder into a draft batch (not yet in the pool): files are grouped
   * into shots by the name before "_C<n>" ("S05_C1.CSV" + "S05_C3.CSV" -> shot "S05"); files
   * without a channel suffix are shots on their own. Parameters are guessed from the folder name.
   */
  async function draft(files, folder) {
    const groups = new Map();
    for (const f of [...files].filter(f => App.series.isSeriesFile(f)).sort((a, b) => App.util.naturalCompare(a.name, b.name))) {
      const m = f.name.match(SHOT_RE), label = m ? m[1] || f.name : f.name.replace(/\.[^.]+$/, '');
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ name: f.name, text: await App.series.readText(f) });
    }
    const prev = batches[batches.length - 1];
    const b = {
      id: App.util.uid(), name: folder || 'Folder ' + (batches.length + 1),
      params: mergeParams(prev ? prev.params.map(p => Object.assign({}, p)) : [], guessParams(folder || '')),
      roles: prev ? Object.assign({}, prev.roles) : { sw: 'C1', cur: 'C3' }, added: Date.now(),
    };
    const list = [...groups].map(([label, fl]) => ({ id: App.util.uid(), batchId: b.id, label, files: fl, current: null, hidden: false }));
    for (const sh of list) parseShot(sh);
    // default roles: keep the previous batch's if those channels exist, else first two channels
    const ids = [...new Set(list.flatMap(sh => Object.keys(sh.cols)))].sort();
    if (!ids.includes(b.roles.sw)) b.roles.sw = ids[0] || 'C1';
    if (!ids.includes(b.roles.cur)) b.roles.cur = ids.find(x => x !== b.roles.sw) || '';
    return { batch: b, shots: list, channels: ids };
  }
  function analyzeDraft(d) { for (const sh of d.shots) analyzeShot(sh, d.batch.roles); }

  /** "NOR45A24_Rg10_24V" -> [{key:'Rg', 10}, {key:'V', 24 V}]; "Rg_1M" -> Rg = 1e6. */
  function guessParams(name) {
    const out = [], tok = name.split(/[_\s,;]+/).filter(Boolean);
    for (let k = 0; k < tok.length; k++) {
      let m = tok[k].match(/^([A-Za-z][A-Za-z]*?)(-?\d+(?:[.p]\d+)?)([GMkmunpµ]?)(Ω|Ohm|V|A|H|F|s|Hz|C)?$/);
      if (m && /^[SC]$/i.test(m[1])) continue;   // shot / channel ids like S01, C3
      if (m) { out.push(param(m[1], m[2].replace('p', '.') + m[3], m[4] || '')); continue; }
      m = tok[k].match(/^(-?\d+(?:[.p]\d+)?)([GMkmunpµ]?)(Ω|Ohm|V|A|H|F|s|Hz)$/);
      if (m) { out.push(param(m[3] === 'Ohm' ? 'R' : m[3], m[1].replace('p', '.') + m[2], m[3])); continue; }
      if (/^[A-Za-z]+$/.test(tok[k]) && k + 1 < tok.length && /^-?\d+(?:[.p]\d+)?[GMkmunpµ]?[A-Za-zΩ]*$/.test(tok[k + 1])) {
        const mm = tok[k + 1].match(/^(-?\d+(?:[.p]\d+)?[GMkmunpµ]?)([A-Za-zΩ]*)$/);
        out.push(param(tok[k], mm[1].replace('p', '.'), mm[2])); k++;
      }
    }
    return out;
  }
  function mergeParams(base, extra) {
    for (const p of extra) { const q = base.find(x => x.key === p.key); if (q) Object.assign(q, p); else base.push(p); }
    return base;
  }
  const PREFIX = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, '': 1, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
  /** Parameter from user text: numeric with SI prefix ("10", "1M", "24 V", "4.7mOhm") or free text (a device name). */
  function param(key, text, unit = '') {
    text = String(text).trim();
    const m = text.replace(',', '.').match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([GMkKmuµμnpf]?)\s*(Ω|Ohm|[A-Za-z]*)$/);
    let value = null;
    if (m) { value = parseFloat(m[1]) * PREFIX[m[2]]; if (m[3] && !unit) unit = m[3] === 'Ohm' ? 'Ω' : m[3]; }
    return { key: String(key).trim(), text, value, unit: unit === 'Ohm' ? 'Ω' : unit };
  }

  async function addDraft(d) {
    batches.push(d.batch); shots.push(...d.shots);
    analyzeDraft(d);
    await putBatch(d.batch);
    await putShots(d.shots);
    App.events.emit('pool-changed');
  }
  async function updateBatch(id, patch) {
    const b = batches.find(x => x.id === id);
    Object.assign(b, patch);
    await putBatch(b);
    if (patch.roles) for (const sh of shots) if (sh.batchId === id) analyzeShot(sh, b.roles);
    App.events.emit('pool-changed');
  }
  async function removeBatch(id) {
    const gone = shots.filter(s => s.batchId === id);
    batches = batches.filter(b => b.id !== id); shots = shots.filter(s => s.batchId !== id);
    await tx('batches', 'readwrite', st => st.delete(id)).catch(report);
    await tx('shots', 'readwrite', st => { for (const sh of gone) st.delete(sh.id); }).catch(report);
    App.events.emit('pool-changed');
  }
  /** Change one or several shots (ids: string or array), saved in one transaction. */
  async function updateShots(ids, patch) {
    const set = new Set([].concat(ids)), list = shots.filter(s => set.has(s.id));
    for (const sh of list) Object.assign(sh, patch);
    await putShots(list);
    App.events.emit('pool-changed');
  }
  async function clear() {
    batches = []; shots = [];
    await tx('batches', 'readwrite', st => st.clear()).catch(report);
    await tx('shots', 'readwrite', st => st.clear()).catch(report);
    App.events.emit('pool-changed');
  }
  async function restore() {
    try {
      const bs = await tx('batches', 'readonly', st => st.getAll());
      const ss = await tx('shots', 'readonly', st => st.getAll());
      batches = (bs || []).sort((a, b) => a.added - b.added);
      const order = new Map(batches.map((b, k) => [b.id, k]));
      shots = (ss || []).filter(s => order.has(s.batchId))
        .sort((a, b) => order.get(a.batchId) - order.get(b.batchId) || App.util.naturalCompare(a.label, b.label));
      for (const sh of shots) analyzeShot(sh, batchOf(sh).roles);
    } catch (e) { report(e); }
    App.events.emit('pool-changed');
  }

  // ---------------------------------------------------------------- derived rows
  /** Shot current: user override, else mean of the current channel. */
  const shotCurrent = sh => sh.current !== null && sh.current !== undefined ? sh.current : sh.res && sh.res.iMean;

  /** All parameter keys in the pool: built-ins first, then batch parameters in order of appearance. */
  function paramKeys() {
    const keys = [
      { key: 'I', label: 'I (shot, C3 mean)', unit: 'A', numeric: true, builtin: true },
      { key: 'I_edge', label: 'I at edge', unit: 'A', numeric: true, builtin: true },
      { key: 'Folder', label: 'Folder', unit: '', numeric: false, builtin: true },
    ];
    for (const b of batches) for (const p of b.params) {
      if (!p.key) continue;
      let k = keys.find(x => x.key === p.key);
      if (!k) keys.push(k = { key: p.key, label: p.key, unit: p.unit, numeric: true });
      if (p.value === null) k.numeric = false;
      if (!k.unit && p.unit) k.unit = p.unit;
    }
    return keys;
  }

  /** Edge keys present in the pool, e.g. ['rise1', 'fall1', 'rise2']. */
  function edgeKeys() {
    const set = new Set();
    for (const sh of shots) for (const e of (sh.res ? sh.res.edges : [])) set.add(e.kind + e.n);
    return [...set].sort((a, b) => a.slice(-1) - b.slice(-1) || (a < b ? 1 : -1));
  }

  /**
   * One row per (shot, edge) - or per shot without edges when edgeKey is null and the shot has none.
   * row = { shot, batch, edge|null, p: { key: value|text } }.
   */
  function rows(edgeKey) {
    const out = [];
    for (const sh of shots) {
      const b = batchOf(sh), edges = sh.res ? sh.res.edges : [];
      const p = { I: shotCurrent(sh), Folder: b.name };
      for (const q of b.params) if (q.key) p[q.key] = q.value !== null ? q.value : q.text;
      const sel = edgeKey ? edges.filter(e => e.kind + e.n === edgeKey) : edges;
      if (!sel.length && !edgeKey) out.push({ shot: sh, batch: b, edge: null, p: Object.assign({ I_edge: null }, p) });
      for (const e of sel) out.push({ shot: sh, batch: b, edge: e, p: Object.assign({ I_edge: e.iEdge }, p) });
    }
    return out;
  }

  // ---------------------------------------------------------------- export / import
  function exportJson() {
    return JSON.stringify({ app: 'dpt-pool', version: 1, settings, batches, shots: shots.map(strip) });
  }
  async function importJson(text, replace = false) {
    const o = JSON.parse(text);
    if (o.app !== 'dpt-pool') throw new Error('not a DPT pool file');
    if (replace) await clear();
    const known = new Set(batches.map(b => b.id));
    for (const b of o.batches) {
      if (known.has(b.id)) continue;
      const list = o.shots.filter(s => s.batchId === b.id);
      await addDraft({ batch: b, shots: list.map(s => Object.assign({}, s)) });
    }
  }

  return {
    get batches() { return batches; }, get shots() { return shots; }, get settings() { return settings; },
    restore, draft, analyzeDraft, addDraft, updateBatch, removeBatch, updateShots, clear, setSettings,
    param, guessParams, shotCurrent, paramKeys, edgeKeys, rows, exportJson, importJson, batchOf,
  };
})();
