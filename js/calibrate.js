// Calibration model: maps image pixels <-> (time, value) per channel.
//
// calib = {
//   grid:     { left, right, top, bottom, hdiv, vdiv }   // graticule in image px
//   time:     { tdiv, tCenter }                           // s/div, time at horizontal grid centre
//   channels: { C1: { on, vdiv, unit, zeroY }, ... }      // V/div and y (image px) of 0 V
//   persistence: bool, persistChannel: 'C4'|null         // colour-graded display mode
// }
// `status` (stored next to calib on the doc) mirrors the fields with 'ok' | 'warn' | 'manual'.
App.calib = (() => {
  // Channel colours / hue windows (RTB2000 family defaults). Used for marker matching
  // and trace extraction. Extend here if another scope uses other colours.
  const CHANNELS = [
    { id: 'C1', color: '#f5e800', hue: [40, 75], minSat: 0.35 },
    { id: 'C2', color: '#1ee01e', hue: [80, 160], minSat: 0.35 },
    { id: 'C3', color: '#ff8a00', hue: [5, 40], minSat: 0.35 },
    { id: 'C4', color: '#9d9bf0', hue: [225, 265], minSat: 0.15 },
  ];
  const channelById = id => CHANNELS.find(c => c.id === id);
  /** Display label of a channel: "C1 (Vout)" if the doc has a custom name for it, else "C1". */
  const chLabel = (doc, id) => { const n = doc && doc.chNames && doc.chNames[id]; return n ? `${id} (${n})` : id; };

  function emptyCalib(width, height) {
    const channels = {};
    CHANNELS.forEach(c => { channels[c.id] = { on: false, vdiv: 1, unit: 'V', zeroY: height / 2 }; });
    return {
      grid: { left: 0, right: width, top: 0, bottom: height, hdiv: 10, vdiv: 8 },
      time: { tdiv: 1e-6, tCenter: 0 },
      channels, persistence: false, persistChannel: null,
    };
  }

  const pxPerDivX = c => (c.grid.right - c.grid.left) / c.grid.hdiv;
  const pxPerDivY = c => (c.grid.bottom - c.grid.top) / c.grid.vdiv;
  const centerX = c => (c.grid.left + c.grid.right) / 2;

  const tAt = (c, x) => c.time.tCenter + (x - centerX(c)) / pxPerDivX(c) * c.time.tdiv;
  const xAt = (c, t) => centerX(c) + (t - c.time.tCenter) / c.time.tdiv * pxPerDivX(c);
  const vAt = (c, ch, y) => (c.channels[ch].zeroY - y) / pxPerDivY(c) * c.channels[ch].vdiv;
  const yAt = (c, ch, v) => c.channels[ch].zeroY - v / c.channels[ch].vdiv * pxPerDivY(c);

  return { CHANNELS, channelById, chLabel, emptyCalib, pxPerDivX, pxPerDivY, centerX, tAt, xAt, vAt, yAt };
})();
