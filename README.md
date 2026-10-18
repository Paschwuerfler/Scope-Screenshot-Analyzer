# Scope Screenshot Analyzer

Measure directly on oscilloscope screenshots: the tool recognises the scope's screen layout,
reads timebase, position, V/div and 0 V levels per channel, extracts the traces, and gives you
two draggable cursors with Δt, 1/Δt, V at each cursor, ΔV and slew rate (ΔV/Δt).

## Start

Double-click **`index.html`** (Chrome or Edge recommended). Nothing to install, works offline.
To use it on another computer, copy the whole folder.

## Loading screenshots

- **Drag & drop** image files or whole folders anywhere onto the window
- **Ctrl+V** pastes a screenshot from the clipboard
- **Open files** / **Open folder** buttons

All loaded images appear in the strip on the left. Each image keeps its own cursors and
calibration, so you can switch freely (**↑/↓** or click a thumbnail).

## Measuring

- Drag a cursor line (or its tag above the grid). **Double-click** moves the nearest cursor there.
- **←/→** nudge the selected cursor by 1 px (**Shift** 10 px, **Alt** ¼ px). **1**/**2**/**Tab** select a cursor.
- The **Cursors** panel shows t1, t2, Δt, 1/Δt and, for each active channel, the trace value at
  both cursors, ΔV and ΔV/Δt. The small grey range under each value is the band the screenshot
  actually shows (trace thickness, sample blocks at fast timebases, persistence spread). Treat
  it as the reading's uncertainty.
- **Copy** (or **C**) copies the readout as tab-separated text, ready to paste into Excel.
- Wheel = zoom, drag empty area = pan, **F** = fit screenshot, **G** = fit graticule.
- **T** shows the extracted traces on top of the image so you can check what was detected.

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
