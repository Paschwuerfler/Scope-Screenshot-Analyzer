// Layout registry. A layout descriptor knows one scope screen layout (e.g. R&S RTB2004
// at 1280x824) and can (a) score how well an image matches it and (b) analyse it into
// a calibration. See docs/EXTENDING.md "Add a scope layout".
//
// Descriptor interface:
//   { id, name,
//     match(img) -> 0..1,                     // fingerprint score; >= 0.5 counts as a match
//     analyze(img) -> { calib, status, notes[], raw } }
App.layouts = (() => {
  const list = [];
  return {
    list,
    register(desc) { list.push(desc); },
    get(id) { return list.find(l => l.id === id) || null; },
    /** Returns {layout, score} of the best match, or {layout:null} if none >= 0.5. */
    detect(img) {
      let best = { layout: null, score: 0 };
      for (const l of list) {
        let s = 0;
        try { s = l.match(img); } catch (e) { console.warn('layout match failed', l.id, e); }
        if (s > best.score) best = { layout: l, score: s };
      }
      return best.score >= 0.5 ? best : { layout: null, score: best.score };
    },
  };
})();
