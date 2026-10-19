# Scope Screenshot Analyzer

Measure directly on oscilloscope screenshots: the tool recognises the scope's screen layout,
reads timebase, position, V/div and 0 V levels per channel, extracts the traces, and gives you
two draggable cursors with Δt, 1/Δt, V at each cursor, ΔV and slew rate (ΔV/Δt).

**▶ [Try it online with a demo screenshot](https://paschwuerfler.github.io/Scope-Screenshot-Analyzer/?demo)**
· [open empty](https://paschwuerfler.github.io/Scope-Screenshot-Analyzer/)

## Start

Use the online version above, or run it locally: double-click **`index.html`** (Chrome or Edge
recommended). Nothing to install, works offline. To use it on another computer, copy the whole
folder. Screenshots you load never leave your computer, even in the online version.
**Load demo** loads an example R&S RTB2004 screenshot.

## Loading screenshots

- **Drag & drop** image files or whole folders anywhere onto the window
- **Ctrl+V** pastes a screenshot from the clipboard
- **Open files** / **Open folder** buttons

All loaded images appear in the strip on the left. Each image keeps its own cursors and
calibration, so you can switch freely (**↑/↓** or click a thumbnail). To rename an image,
double-click its name, use the ✎ button on the thumbnail, or press **F2**
(**Enter** saves, **Esc** cancels). The name is also used in copied readouts and exports.

## Measuring

- Drag a cursor line (or its tag above the grid). **Double-click** moves the nearest cursor there.
- **←/→** nudge the selected cursor by 1 px (**Shift** 10 px, **Alt** ¼ px). **1**/**2**/**Tab** select a cursor.
- The **Cursors** panel shows t1, t2, Δt, 1/Δt and, for each active channel, the trace value at
  both cursors, ΔV and ΔV/Δt. The small grey range under each value is the band the screenshot
  actually shows (trace thickness, sample blocks at fast timebases, persistence spread). Treat
  it as the reading's uncertainty.
- **Copy** (or **C**) copies the readout as tab-separated text, ready to paste into Excel.
- **Multi-period** (**P**) measures ringing frequency over several cycles:
  1. Put the cursors on two adjacent peaks, then switch on **Multi-period**. That spacing becomes the reference period.
  2. Drag cursor 2 to a later peak. The tool counts the periods N in between and draws N−1
     numbered dashed lines, evenly spaced. If they all sit on peaks, the frequency is constant.
  3. The panel shows N, the period T = Δt/N and the frequency **N/Δt**. This is about N times more
     precise than reading one period. If N is counted wrong, correct it with **−/+** (or **,** / **.**).
  4. For each channel, **amplitude** is (max − min)/2 within each cycle, averaged over the N cycles.
     The grey range below it shows the smallest and largest cycle, so you can see the decay.
  
  The mode is saved per image. Click the button again (or **P**) to switch it off. Moving
  cursor 1 to another cycle also switches it off.
- Wheel = zoom, drag empty area = pan, **F** = fit screenshot, **G** = fit graticule.
- **Detection overlay** (**D**) dims the screenshot and shows what the tool detected: every grid
  line labelled with the time/voltage the calibration assigns to it (should match the scope's own
  grid and labels), each channel's 0 level, the extracted curve and its band. Use it to sanity-check
  a screenshot before trusting the numbers.

## Checking / fixing the calibration

The **Calibration** panel shows every detected value with a badge:
✓ detected and confirmed by two sources, **!** uncertain (check it), ✎ set by you.
All fields are editable (type e.g. `5 ns`, `200 mV`, `2.5 µs`). Use ⌖ to click a channel's
0 level on the image. **Re-detect** discards your edits.

Screenshots from an unknown scope: open *Graticule*, click **Pick grid on image…**, drag a
rectangle over the outer grid border, enter the number of divisions, then set time/div, the time at
the centre, and per channel V/div and 0 level.

Supported layouts: **R&S RTB2004** (1280×824 screenshots, normal and persistence display).

## Saving

Everything (images, cursors, edits) is saved automatically in the browser and restored the next
time you open `index.html` in the same browser. **Export session** writes everything to a
`.json` file. Import it (or drop it onto the window) on another computer.

Press **?** in the app for all shortcuts.
