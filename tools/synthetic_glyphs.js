// Hand-drawn glyphs for characters that do not (yet) appear in any sample screenshot.
// They are only used when tools/harvest.html found no real instance of that character.
// Once a screenshot containing the character is added to samples/ (+ tools/samples.js),
// re-run tools/build_glyphs.ps1 and the real glyph replaces the synthetic one.
//
// small: 5 columns x 11 rows, row-major, '#' = lit pixel. Rows 0..8 = cap height,
// rows 3..8 = x-height (compare harvested 'n', 's'), rows 9..10 = descender.
(() => {
  const g = (...rows) => {
    while (rows.length < 11) rows.push('.....');
    return rows.join('').replace(/#/g, '1').replace(/\./g, '0');
  };
  const X = '.....';
  window.SYNTHETIC_GLYPHS = {
    small: {
      '.': [g(X, X, X, X, X, X, X, X, '..#..')],
      'm': [g(X, X, X, '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#', '#.#.#')],
      'µ': [g(X, X, X, '#...#', '#...#', '#...#', '#...#', '#..##', '###.#', '#....', '#....')],
      'u': [g(X, X, X, '#...#', '#...#', '#...#', '#...#', '#..##', '.##.#')],
      'p': [g(X, X, X, '#.##.', '##..#', '#...#', '#...#', '##..#', '#.##.', '#....', '#....')],
      'k': [g('#....', '#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#')],
      'A': [g('..#..', '.#.#.', '#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#')],
    },
  };
})();
