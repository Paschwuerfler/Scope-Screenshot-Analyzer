// Entry point: wires toolbar buttons and keyboard shortcuts, restores the last session.
// Keyboard map lives in KEYS below — keep it in sync with the help dialog in index.html.
(() => {
  const $ = sel => document.querySelector(sel);

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
    '+': () => App.view.zoom(1.25),
    '=': () => App.view.zoom(1.25),
    '-': () => App.view.zoom(0.8),
    't': () => App.ui.togglePref('showTraces'),
    'o': () => App.ui.togglePref('showCalib'),
    'l': () => App.ui.togglePref('showValueLabels'),
    'c': e => { if (!e.ctrlKey && !e.metaKey) copyReadout(); else return false; },
    'Escape': () => App.view.setMode(null),
    '?': () => $('#help').showModal(),
    'F1': () => $('#help').showModal(),
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

  async function exportSession() {
    if (!App.docs.list().length) { App.ui.toast('Nothing to export.'); return; }
    const blob = await App.docs.exportSession();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `scope-session-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function init() {
    // Surface unexpected errors instead of failing silently.
    window.addEventListener('error', e => App.ui.toast('Error: ' + e.message));
    window.addEventListener('unhandledrejection', e => App.ui.toast('Error: ' + (e.reason && e.reason.message || e.reason)));
    App.view.init($('#view'));
    App.ui.init();
    App.loaders.init({ dropTarget: document.body, onDragState: on => document.body.classList.toggle('dragging', on) });

    const click = (sel, fn) => document.querySelectorAll(sel).forEach(el => el.addEventListener('click', fn));
    click('[data-act="open-files"]', () => App.loaders.pick('files'));
    click('[data-act="open-folder"]', () => App.loaders.pick('folder'));
    click('[data-act="import"]', () => App.loaders.pick('session'));
    click('[data-act="export"]', exportSession);
    click('[data-act="clear"]', () => { if (confirm('Remove all images from this session?')) App.docs.clear(); });
    click('[data-act="help"]', () => $('#help').showModal());
    click('[data-act="copy"]', copyReadout);
    click('[data-act="fit"]', () => App.view.fit());
    click('[data-act="fit-grid"]', () => App.view.fitGrid());
    click('[data-act="zoom-in"]', () => App.view.zoom(1.25));
    click('[data-act="zoom-out"]', () => App.view.zoom(0.8));
    click('#tgl-traces', () => App.ui.togglePref('showTraces'));
    click('#tgl-calib', () => App.ui.togglePref('showCalib'));
    click('#tgl-labels', () => App.ui.togglePref('showValueLabels'));
    click('#help [data-act="close"]', () => $('#help').close());
    window.addEventListener('keydown', onKey);

    App.ui.renderAll();
    App.docs.restore().then(() => {
      App.ui.renderAll();
      // Dev hook: index.html?demo loads the sample screenshots (see tools/demo.js).
      if (new URLSearchParams(location.search).has('demo')) {
        const s = document.createElement('script'); s.src = 'tools/demo.js'; document.head.appendChild(s);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
