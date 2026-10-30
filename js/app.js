// Entry point: wires toolbar buttons and keyboard shortcuts, restores the last session.
// Keyboard map lives in KEYS below — keep it in sync with the help dialog in index.html.
(() => {
  const $ = sel => document.querySelector(sel);
  const ZOOM_IN = 1.25, ZOOM_OUT = 0.8;   // keys + / − and the toolbar buttons
  const showHelp = () => $('#help').showModal();

  const KEYS = {
    'ArrowLeft': e => App.view.nudge(-step(e)),
    'ArrowRight': e => App.view.nudge(step(e)),
    'ArrowUp': () => App.docs.step(-1),
    'ArrowDown': () => App.docs.step(1),
    'PageUp': () => App.docs.step(-1),
    'PageDown': () => App.docs.step(1),
    '1': () => App.view.selectCursor(1),
    '2': () => App.view.selectCursor(2),
    'Tab': () => { const d = App.docs.active(); if (d) App.view.selectCursor(d.cursors.sel === 1 ? 2 : 1); },
    'f': () => App.view.fit(),
    '0': () => App.view.fit(),
    'g': () => App.view.fitGrid(),
    '+': () => App.view.zoom(ZOOM_IN),
    '=': () => App.view.zoom(ZOOM_IN),
    '-': () => App.view.zoom(ZOOM_OUT),
    'd': () => App.ui.togglePref('showOverlay'),
    's': () => App.ui.togglePref('bigText'),
    'c': e => { if (!e.ctrlKey && !e.metaKey) copyReadout(); else return false; },
    'p': () => App.view.togglePeriods(),
    ',': () => App.view.stepPeriods(-1),
    '.': () => App.view.stepPeriods(1),
    'F2': () => App.ui.startRename(),
    'm': () => App.ui.openMerge(),
    'Escape': () => App.view.setMode(null),
    '?': showHelp,
    'F1': showHelp,
  };
  // Arrow step in image px: plain 1, Shift 10, Alt 0.25 (sub-pixel)
  const step = e => (e.shiftKey ? 10 : e.altKey ? 0.25 : 1);

  function onKey(e) {
    if (e.target.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
    const fn = KEYS[e.key] || KEYS[e.key.toLowerCase()];
    if (!fn || (e.ctrlKey && e.key !== 'c')) return;
    if (fn(e) !== false) e.preventDefault();
  }

  async function copyReadout() {
    const tsv = App.ui.readoutTSV();
    if (!tsv) return;
    try { await navigator.clipboard.writeText(tsv); App.ui.toast('Readout copied (tab-separated, paste into Excel).'); }
    catch { App.ui.toast('Clipboard not available.'); }
  }

  /** Copy the plot canvas as an image; falls back to downloading a PNG where the clipboard refuses. */
  async function copyImage() {
    const d = App.docs.active();
    if (!d) { App.ui.toast('Nothing to copy.'); return; }
    const blob = await App.view.toBlob();
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      App.ui.toast('Plot copied to the clipboard as an image.');
    } catch {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = d.name.replace(/\.[^.]+$/, '') + '.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      App.ui.toast('Clipboard not available here, so the image was downloaded instead.');
    }
  }

  // Above this size the export asks how to store CSV waveforms (lossless / 16 bit / original files)
  const EXPORT_ASK_BYTES = 1024 * 1024;
  async function exportSession() {
    const docs = App.docs.list();
    if (!docs.length) { App.ui.toast('Nothing to export.'); return; }
    const opts = { exact: await App.docs.exportSession('exact') };
    const encs = docs.filter(d => d.kind === 'series').flatMap(App.docs.blobsOf).map(App.series.packedEnc);
    let mode = 'exact';
    if (opts.exact.blob.size > EXPORT_ASK_BYTES && encs.some(e => e !== 'q16')) {
      App.ui.toast('Preparing smaller export formats…');
      opts.lossless = await App.docs.exportSession('lossless');
      opts.compact = await App.docs.exportSession('compact');
      // all CSVs already packed (imported from a compact export): "original files" = lossless
      if (!encs.some(e => !e)) { opts.lossless = opts.exact; delete opts.exact; }
      mode = await App.ui.askExport(opts);
      if (!mode) return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(opts[mode].blob);
    a.download = `scope-session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}${mode === 'compact' ? '-16bit' : ''}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function init() {
    // Surface unexpected errors instead of failing silently.
    window.addEventListener('error', e => App.ui.toast('Error: ' + e.message));
    window.addEventListener('unhandledrejection', e => App.ui.toast('Error: ' + (e.reason && e.reason.message || e.reason)));
    App.view.init($('#view'));
    App.overview.init($('#overview'));
    App.ui.init();
    App.loaders.init({ dropTarget: document.body, onDragState: on => document.body.classList.toggle('dragging', on) });

    const click = (sel, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn));
    click('[data-act="open-files"]', () => App.loaders.pick('files'));
    click('[data-act="open-folder"]', () => App.loaders.pick('folder'));
    click('[data-act="import"]', () => App.loaders.pick('session'));
    click('[data-act="demo"]', () => App.loaders.loadDemo());
    click('[data-act="export"]', exportSession);
    click('[data-act="clear"]', () => { if (confirm('Remove all images from this session?')) App.docs.clear(); });
    click('[data-act="help"]', showHelp);
    click('[data-act="copy"]', copyReadout);
    click('[data-act="periods"]', () => App.view.togglePeriods());
    click('[data-act="fit"]', () => App.view.fit());
    click('[data-act="fit-grid"]', () => App.view.fitGrid());
    click('[data-act="zoom-in"]', () => App.view.zoom(ZOOM_IN));
    click('[data-act="zoom-out"]', () => App.view.zoom(ZOOM_OUT));
    click('#tgl-overlay', () => App.ui.togglePref('showOverlay'));
    click('#tgl-bigtext', () => App.ui.togglePref('bigText'));
    click('#btn-copyimg', copyImage);
    click('#help [data-act="close"]', () => $('#help').close());
    window.addEventListener('keydown', onKey);

    App.ui.renderAll();
    App.docs.restore().then(() => {
      App.ui.renderAll();
      App.loaders.initHandoff();   // shots sent from the DPT page
      const q = new URLSearchParams(location.search);
      // index.html?demo loads the built-in demo screenshot (used by the README link).
      if (q.has('demo')) {
        history.replaceState(null, '', location.pathname); // so a reload doesn't add it again
        App.loaders.loadDemo();
      }
      // Dev hook: index.html?samples=N replaces the session with all samples (see tools/demo.js).
      if (q.has('samples')) {
        const s = document.createElement('script'); s.src = 'tools/demo.js'; document.head.appendChild(s);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
