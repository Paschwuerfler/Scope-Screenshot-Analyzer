// Shared helpers: SI formatting/parsing, colour conversion, small utilities.
// Everything hangs off the global `App` namespace (classic scripts, no modules,
// so the app runs straight from file://).
window.App = window.App || {};

App.util = (() => {
  const PREFIXES = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''],
    [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
  ];
  const PREFIX_VALUE = { G: 1e9, M: 1e6, k: 1e3, K: 1e3, '': 1, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

  /** Format a number in engineering notation, e.g. formatSI(2.1e-9, 's') -> "2.1 ns". */
  function formatSI(value, unit = '', digits = 4) {
    if (value === null || value === undefined || !isFinite(value)) return '–';
    if (value === 0) return `0 ${unit}`.trim();
    const abs = Math.abs(value);
    let [mult, pre] = PREFIXES[PREFIXES.length - 1];
    for (const p of PREFIXES) { if (abs >= p[0] * 0.9995) { [mult, pre] = p; break; } }
    const scaled = value / mult;
    // toPrecision then strip trailing zeros: 2.100 -> 2.1
    let s = Number(scaled.toPrecision(digits)).toString();
    return `${s} ${pre}${unit}`.trim();
  }

  /** Format a range "lo … hi unit" with one shared prefix, e.g. "-0.36 … 4.11 V". */
  function formatRange(lo, hi, unit = '', digits = 3) {
    if (!isFinite(lo) || !isFinite(hi)) return '–';
    const abs = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    let [mult, pre] = PREFIXES[PREFIXES.length - 1];
    for (const p of PREFIXES) { if (abs >= p[0] * 0.9995) { [mult, pre] = p; break; } }
    const dec = Math.max(0, digits - 1 - Math.floor(Math.log10(abs / mult)));
    return `${(lo / mult).toFixed(dec)} … ${(hi / mult).toFixed(dec)} ${pre}${unit}`;
  }

  /**
   * Format a rate per second (e.g. slew rate in V/s) as unit per time prefix, so the
   * mantissa lands in 1..1000: 1.43e10 V/s -> "14.3 V/ns", 6.6e8 -> "663 V/µs".
   */
  function formatRate(perSecond, unit = 'V', digits = 4) {
    if (perSecond === null || perSecond === undefined || !isFinite(perSecond)) return '–';
    const steps = [[1, 's'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns'], [1e-12, 'ps']];
    let pick = steps[0];
    for (const st of steps) { pick = st; if (Math.abs(perSecond * st[0]) < 1000) break; }
    return `${Number((perSecond * pick[0]).toPrecision(digits))} ${unit}/${pick[1]}`;
  }

  /**
   * Parse a quantity like "5 ns", "-1.2 µs/", "500mV", "10 v/" -> {value, unit}.
   * `expectUnit` (e.g. 's' or 'V') lets bare numbers parse and resolves 'm' ambiguity.
   * Returns null if nothing numeric is found.
   */
  function parseSI(str, expectUnit) {
    if (str === null || str === undefined) return null;
    const s = String(str).trim().replace(/,/g, '.').replace(/\s+/g, ' ');
    const m = s.match(/^([-+−]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([GMkKmuµμnpf]?)\s*([a-zA-Z]*)\s*\/?\s*(?:div)?$/);
    if (!m) return null;
    let num = parseFloat(m[1].replace('−', '-'));
    let pre = m[2];
    let unit = m[3];
    // "m" alone with an expected unit means milli (e.g. user typed "5m" for 5 ms)
    if (!unit && expectUnit) unit = expectUnit;
    // A bare "s"/"V" that regex captured as prefix-less unit is fine. Edge case: "5 m" -> prefix m, unit ''.
    if (unit && expectUnit && unit.toLowerCase() !== expectUnit.toLowerCase()) {
      // e.g. "5 ms" parsed as pre='m', unit='s' already; anything else is a mismatch
      return null;
    }
    if (!(pre in PREFIX_VALUE)) return null;
    return { value: num * PREFIX_VALUE[pre], unit: unit || '' };
  }

  /** RGB (0..255) -> {h:0..360, s:0..1, v:0..1}. */
  function rgb2hsv(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
  }

  /** Next value in the 1-2-5 sequence above (dir > 0) or below (dir < 0) v, like a scope's scale knob. */
  function step125(v, dir) {
    const e = Math.pow(10, Math.floor(Math.log10(v) + 1e-9)), m = v / e;
    const seq = [1, 2, 5, 10], eps = 1e-6;
    if (dir > 0) return (seq.find(s => s > m + eps) || 20) * e;
    const below = seq.filter(s => s < m - eps);
    return (below.length ? below[below.length - 1] : 0.5) * e;
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const median = (arr) => {
    if (!arr.length) return NaN;
    const a = [...arr].sort((x, y) => x - y), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /** Natural sort compare ("img2" < "img10"). */
  const naturalCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

  /** Debounce: returns fn that delays calls until `ms` of quiet. */
  function debounce(fn, ms) {
    let t = null;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { formatSI, formatRange, formatRate, parseSI, rgb2hsv, step125, clamp, median, uid, naturalCompare, debounce, escapeHtml };
})();

/** Tiny pub/sub used to decouple modules: App.events.on('doc-updated', fn) / emit(...). */
App.events = (() => {
  const handlers = {};
  return {
    on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    emit(name, ...args) { (handlers[name] || []).forEach(fn => fn(...args)); },
  };
})();
