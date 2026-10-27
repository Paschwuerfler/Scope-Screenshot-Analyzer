# Scope Screenshot Analyzer

Measure directly on oscilloscope screenshots: the tool recognises the scope's screen layout,
reads timebase, position, V/div and 0 V levels per channel, extracts the traces, and gives you
two draggable cursors with Δt, 1/Δt, V at each cursor, ΔV and slew rate (ΔV/Δt).
CSV waveform exports work too, with exact sample values and time-axis zoom.

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

All loaded images appear in the strip on the left (in windows narrower than 3:2, the layout
switches to rows: image on top, cursors and calibration below, the images as a bar at the bottom).
Drag the border between the image and the side panel to give either more room. Double-click
the border to reset it. Each image keeps its own cursors and
calibration, so you can switch freely (**↑/↓** or click a thumbnail). To rename an image,
double-click its name, use the ✎ button on the thumbnail, or press **F2**
(**Enter** saves, **Esc** cancels). The name is also used in copied readouts and exports.

## Measuring

- Drag a cursor line (or its tag above the grid). **Double-click** moves the nearest cursor there.
- **←/→** nudge the selected cursor by 1 px (**Shift** 10 px, **Alt** ¼ px). **1**/**2**/**Tab** select a cursor.
- The **Cursors** panel puts the results first. The time block and each probed channel's block
  (tinted in the channel colour) start with a small line of the values at cursor
  **1** → cursor **2**, followed by the results: Δt and 1/Δt, or ΔV and ΔV/Δt. Clicking a small
  1/2 tag selects that cursor. The colour-matched channel buttons next to the heading choose which
  channels the cursors read. The default is one channel: the scope's selected channel, otherwise
  the first active one. The "band" line under a channel's cursor values is the range the screenshot
  actually shows (trace thickness, sample blocks at fast timebases, persistence spread). Treat
  it as the reading's uncertainty.
- **Copy** (or **C**) copies the readout as tab-separated text, ready to paste into Excel.
- **Multi-period** (**P**) measures ringing frequency over several cycles:
  1. Put the cursors on two adjacent peaks, then switch on **Multi-period**. That spacing becomes the reference period.
  2. Drag cursor 2 to a later peak. The tool counts the periods N in between and draws N−1
     numbered dashed lines, evenly spaced. If they all sit on peaks, the frequency is constant.
  3. The panel shows the frequency **f = N/Δt** with N and the period T = Δt/N. This is about N times more
     precise than reading one period. If N is counted wrong, correct it with **−/+** (or **,** / **.**).
  4. For each channel, **amp** (under ΔV) is (max − min)/2 within each cycle, averaged over the N
     cycles, next to the average pk-pk. The **cycles** range shows the smallest and largest cycle,
     so you can see the decay.
  
  The mode is saved per image. Click the button again (or **P**) to switch it off. Moving
  cursor 1 to another cycle also switches it off.
- Wheel = zoom, drag empty area = pan, **F** = fit screenshot, **G** = fit graticule.
- **Detection overlay** (**D**) dims the screenshot and shows what the tool detected: every grid
  line labelled with the time/voltage the calibration assigns to it (should match the scope's own
  grid and labels), each channel's 0 level, the extracted curve and its band. Use it to sanity-check
  a screenshot before trusting the numbers.

## CSV waveform exports

Scope waveform exports (`.csv`, `.txt`, `.tsv`) load like screenshots: drop them, open them, or
paste CSV text with **Ctrl+V** (also copied Excel columns). The first column is time, up to four
more columns become channels C1–C4. Headers like `C1 in V`, `CH2 [mA]` or `Current (A)` set
names and units. Metadata lines at the top, `;`/tab separators and decimal commas are handled.

LTspice waveform exports (File → Export data as text, `.txt`) work too: SPICE names such as
`V(out)` or `I(R1)` become the channel names with unit V or A. Simulation time steps are not
uniform, so the data is resampled linearly onto a uniform grid at the median step (a note in the
Display panel says so). For a `.step` simulation only the first run is loaded.

- The plot looks like a scope screen. Values at the cursors come straight from the samples
  (interpolated between samples), so there is no uncertainty band.
- **Wheel** zooms the **time axis only**, around the pointer. **Drag** empty plot area pans.
  **Shift+wheel** or sideways touchpad scrolling also pans. **F** shows everything.
  The time grid stays at round times and moves with the waveform. Its spacing jumps to the next
  1-2-5 time/div as you zoom.
- The **overview bar** above the plot shows the whole recording, with the visible part framed.
  Drag the frame to pan and drag its edges to zoom. Drag a cursor line to move that cursor.
  Click elsewhere to jump there, use the wheel to zoom, and double-click to show everything.
- **Drag a channel's handle** (the coloured marker left of the plot, at its 0 level) up or down
  to shift its offset. It snaps to the division lines; hold **Shift** to place it freely. The
  **wheel over a handle** changes that channel's scale in 1-2-5 steps and keeps the 0 level in place.
  The grip dots on the handle mark it as draggable. Hovering it shows a tooltip with the current
  scale and these controls.
- The **Display** panel (in place of Calibration) shows samples, length and sample rate on one
  line and sets the visible time/div and centre time. It also sets each channel's scale/div and centre value, or switches
  a channel off. The **wheel** over a scale/div field steps through 1-2-5 (wheel up = larger
  waveform), as do **↑/↓** in the field. **Auto scale** fits all channels again.
- Cursors, Multi-period mode, Copy, rename, saving and export work as for screenshots. When
  zoomed out, **←/→** move the cursor by one screen pixel instead of one sample.

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
