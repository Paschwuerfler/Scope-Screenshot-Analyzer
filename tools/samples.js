// Ground truth for the sample screenshots in samples/.
// Used by tools/harvest.html (to cut OCR glyph templates) and tools/test.html (regression test).
//
// To add a sample: copy the screenshot into samples/, add an entry here with what the
// scope screen shows, then re-run tools/build_glyphs.ps1 and tools/run_tests.ps1.
//
//   tdiv/pos      : timebase (s/div) and horizontal position (time at screen centre, s)
//   channels      : active channels -> V/div and the 0 V level in image px (y)
//   selected      : channel whose scale the y-axis labels show
//   header        : exact text of header boxes (anti-aliased font), keyed by region name
//                   of the layout (see js/layouts/rtb2004.js REGIONS)
//   bottom        : exact text of the V/div field of each active channel's bottom-bar box
//   scopeCursor   : the scope's own cursor readout, used to verify our measurement chain
//   split         : persistence only — true if the waveform population visibly splits into two
//                   branches (expects a second trace branch `alt` with >= 100 columns)
window.SAMPLES = [
  {
    file: 'rtb2004_rise_c1c3_5ns.png', layout: 'rtb2004', tdiv: 5e-9, pos: 20e-9, persistence: false,
    channels: { C1: { vdiv: 10, zeroY: 522.8 }, C3: { vdiv: 10, zeroY: 522.8 } }, selected: 'C1',
    header: { timebase: '5 ns/', position: '20 ns', trigLevel: '25.6 V', sampleRate: '2.5 GSa/s', trigMode: 'Auto', acqState: 'Complete', acqMode: 'Sample' },
    bottom: { C1: '10 v/', C3: '10 v/' },
    scopeCursor: { ch: 'C3', t1: -200e-12, t2: 1.9e-9, v1: 10.645, v2: 40.625 },
  },
  {
    file: 'rtb2004_fall_c1_5ns.png', layout: 'rtb2004', tdiv: 5e-9, pos: 22e-9, persistence: false,
    channels: { C1: { vdiv: 10, zeroY: 522.8 } }, selected: 'C1',
    header: { timebase: '5 ns/', position: '22 ns', trigLevel: '25.6 V', sampleRate: '2.5 GSa/s', trigMode: 'Auto', acqState: 'Complete', acqMode: 'Sample' },
    bottom: { C1: '10 v/' },
    scopeCursor: { ch: 'C1', t1: -1.1e-9, t2: 0.8e-9, v1: 40.039, v2: 9.9609 },
  },
  {
    file: 'rtb2004_fall_c1c3_5ns.png', layout: 'rtb2004', tdiv: 5e-9, pos: 20e-9, persistence: false,
    channels: { C1: { vdiv: 10, zeroY: 522.8 }, C3: { vdiv: 10, zeroY: 522.8 } }, selected: 'C3',
    header: { timebase: '5 ns/', position: '20 ns', trigLevel: '25.6 V', sampleRate: '2.5 GSa/s', trigMode: 'Auto', acqState: 'Complete', acqMode: 'Sample' },
    bottom: { C1: '10 v/', C3: '10 v/' },
    scopeCursor: { ch: 'C3', t1: -1.2e-9, t2: 1.25e-9, v1: 40.43, v2: 10.059 },
  },
  {
    file: 'rtb2004_rise_c4_persist_10ns.png', layout: 'rtb2004', tdiv: 10e-9, pos: 38e-9, persistence: true, split: false,
    channels: { C4: { vdiv: 10, zeroY: 583.2 } }, selected: 'C4',
    header: { timebase: '10 ns/', position: '38 ns', trigLevel: '28.6 V', sampleRate: '2.5 GSa/s', trigMode: 'Auto', acqState: 'Complete', acqMode: 'Sample' },
    bottom: { C4: '10 v/' },
    scopeCursor: { ch: 'C4', t1: -7e-9, t2: 0.4e-9, v1: 5.5664, v2: 35.449 },
  },
  {
    file: 'rtb2004_rise_c4_persist_40ns.png', layout: 'rtb2004', tdiv: 40e-9, pos: 8e-9, persistence: true, split: true,
    channels: { C4: { vdiv: 10, zeroY: 583.2 } }, selected: 'C4',
    header: { timebase: '40 ns/', position: '8 ns', trigLevel: '18.8 V', sampleRate: '2.5 GSa/s', trigMode: 'Auto', acqState: 'Complete', acqMode: 'Sample' },
    bottom: { C4: '10 v/' },
    scopeCursor: { ch: 'C4', t1: -5.2e-9, t2: 4.8e-9, v1: -1.0742, v2: 42.188 },
  },
];
