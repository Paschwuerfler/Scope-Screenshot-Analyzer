# Scope Screenshot Analyzer

Measure directly on oscilloscope screenshots: the tool recognises the scope's screen layout,
reads timebase, position, V/div and 0 V levels per channel, extracts the traces, and gives you
two draggable cursors with Δt, 1/Δt, V at each cursor, ΔV and slew rate (ΔV/Δt).
CSV waveform exports work too, with exact sample values and time-axis zoom.
A second page, **DPT Sweep** (`dpt.html`), overlays double-pulse-test shots and plots slew rate,
overshoot and ringing against current, gate resistor or any other parameter.

**▶ [Try it online with a demo screenshot](https://paschwuerfler.github.io/Scope-Screenshot-Analyzer/?demo)**
· [open empty](https://paschwuerfler.github.io/Scope-Screenshot-Analyzer/)
· [DPT sweep](https://paschwuerfler.github.io/Scope-Screenshot-Analyzer/dpt.html)

## Start

Use the online version above, or run it locally: double-click **`index.html`** (Chrome or Edge
recommended). Nothing to install, works offline. To use it on another computer, copy the whole
folder. Screenshots you load never leave your computer, even in the online version.
**Load demo** loads an example R&S RTB2004 screenshot.

## Loading screenshots

- **Drag & drop** image files or whole folders anywhere onto the window
- **Ctrl+V** pastes a screenshot from the clipboard
- **Open files** / **Open folder** buttons

Transparent areas in an image (e.g. PNGs with transparent margins) are shown as white.

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

## Screenshot mode

**Screenshot mode** (button above the plot, or **S**) draws all text in the plot much larger:
cursor tags, values, legend, axis labels, the Δt bracket and the detection overlay. Use it when
you take screenshots of the app for slides or reports. Press **S** again to switch back.
**Copy image** next to it puts the plot on the clipboard as a PNG image, at full screen
resolution, ready to paste. If the browser does not allow clipboard access, the image is
downloaded instead.

## CSV waveform exports

Scope waveform exports (`.csv`, `.txt`, `.tsv`) load like screenshots: drop them, open them, or
paste CSV text with **Ctrl+V** (also copied Excel columns). The first column is time, up to four
more columns become channels C1–C4. Headers like `C1 in V`, `CH2 [mA]` or `Current (A)` set
names and units. A header other than C1…C4 / CH1…CH4 becomes the channel's name, shown as
e.g. **C1 (Current)** in the plot legend, the cursor readout, the status bar and copied values. Metadata lines at the top, `;`/tab separators and decimal commas are handled.

LTspice waveform exports (File → Export data as text, `.txt`) work too: SPICE names such as
`V(out)` or `I(R1)` become the channel names (`Vout`, `IR1`) with unit V or A. Simulation time steps are not
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
- The **y axis is labelled in one channel's colour**, like on a scope. That is the channel you
  touched last: the probe chip you switched on next to "Cursors", the handle you dragged or
  scrolled, the scale you changed, or the channel chip you clicked in the Display panel
  (the chip with the white ring is the current one).
- The **Display** panel (in place of Calibration) shows samples, length and sample rate on one
  line and sets the visible time/div and centre time. It also sets each channel's name, scale/div and centre value, or switches
  a channel off. Clear the name field to show just C1. The **wheel** over a scale/div field steps through 1-2-5 (wheel up = larger
  waveform), as do **↑/↓** in the field. **Auto scale** fits all channels again. For 10 s
  afterwards the button reads **↶ Undo** and brings your previous settings back.
- The small **V / A** button next to each scale/div field switches the channel's unit, for
  example when a current column was read as volts (`I(L1) RLR=680`). Values stay the same, only
  the unit in the readout, axis labels and legend changes. Auto scale keeps the unit you chose.
- **Copy settings** / **Paste settings** (below the channel table) carry the display settings
  from one CSV to another: each channel's on/off, scale and offset, the visible time window and
  the axis channel. Channels are matched by C1…C4; a channel whose unit differs (V vs A) is
  skipped. After pasting, Paste turns into **↶ Undo** for 10 s.
- Cursors, Multi-period mode, Copy, rename, saving and export work as for screenshots. When
  zoomed out, **←/→** move the cursor by one screen pixel instead of one sample.

### Merging CSVs into one plot

To compare recordings (two scope captures, or a measurement against an LTspice simulation), put
them in one plot:

1. **Drag a CSV's thumbnail onto another one** in the strip (the target shows **Merge**). You can also
   use the **⧉** button on a thumbnail, or press **M**.
2. The dialog lists the channels of both. Choose which to keep (at most 4), their names and which
   channel (C1…C4) each becomes. Picking a channel that is already taken swaps the two. Channels without a name
   from the added file are named after it, e.g. **WFM05 C1**.
3. **Merge** adds a new view after the first one. The originals stay unless you tick *Remove the two
   original views*. Each recording keeps its own samples and sample rate, so cursor values stay exact.
   The new view starts with the cursors and visible time window of the first recording.

**Aligning on the time axis.** The recordings start on their own time stamps (t = 0 is usually
the trigger). The first recording is the time reference. The other one has a single **time offset**
against it, shown under **Time offset against …** in the Display panel. Merging two files gives one
number; each further merged file adds one more. To set it:
- type it (e.g. `-12.5 ns`), or use the wheel or **↑/↓** in the field (1/10 of the visible
  time/div, **Shift** = 1 div);
- **Align**: put one cursor on a feature (an edge, a peak) of the reference and the other cursor on
  the same feature of the other recording, in either order, then click **Align**. The other
  recording moves so its feature lands on the reference's cursor, and its cursor moves with it. The
  app tells which cursor is on which recording by comparing the curve shapes around the two
  cursors; if that is unclear, it assumes cursor 1 is on the reference. The message after Align
  says which way it went. For 10 s the button reads **↶ Undo**, which also puts the cursors back;
- **Ctrl+drag a curve** of the other recording in the plot to slide it sideways (the reference stays put).

A merged view can be merged again with another CSV. Screenshots cannot be merged, because they
have no sample data.

## DPT sweep (double-pulse tests)

Open **`dpt.html`** (or **DPT sweep** in the analyzer's toolbar). It collects many shots from
several folders into one **pool** and compares their switching edges.

1. **Drop a folder** (or **Add folder**). Files are paired per shot by the name before `_C<n>`:
   `S05_C1.CSV` + `S05_C3.CSV` = shot `S05`. A file with several columns is a shot on its own.
2. The **Add folder** dialog lists the shots, their measured current and the edges found. Choose
   which channel is the **switch node** (default C1) and which the **current** (default C3), and enter
   what is **constant in this folder**, e.g. `Rg = 10 Ω`, `Vdc = 24 V`, `Device = GaN-A`. Values are
   pre-filled from the previous folder and from the folder name (`NOR45A24_Rg10_24V` → Rg = 10,
   V = 24 V). The current of a shot can be overridden there. When you save a folder with a parameter
   that none of the folders already in the pool has, you are asked for its value in those folders
   (<kbd>Enter</kbd> fills it in, **Leave empty** / <kbd>Esc</kbd> skips).
   A yellow box above the shot list warns when the folder was recorded at another sample rate than
   the folders already in the pool, or when a shot's switch node or current looks clipped (the record
   sits flat at its limit). **Import pool** shows the same checks in its message.
3. Repeat with the next folder (e.g. the same current steps with another gate resistor). Several
   folders dropped at once open one dialog after another. **Edit** on a folder changes all of this later.

The **shot current** `I` is the mean of the current channel over the whole record (or the value
entered for the shot).

**Views** (all share hover and pins: hover a curve, point or row to highlight that shot everywhere,
click to pin it, <kbd>Esc</kbd> to unpin):
- **Overlay**: the switch node of every shown shot, aligned at the 50 % crossing of the selected edge
  (*Rising edge 1*, *Falling edge 1*, …; <kbd>E</kbd> cycles). Colour by a numeric parameter = blue
  ramp (dim = low, log scale when the values span more than 20×), by a text parameter = one colour
  per value. Wheel zooms the time axis, drag pans, double-click or <kbd>F</kbd> fits.
- **Trend**: one metric (Y) against a numeric parameter (X), one line and marker shape per value of
  *Group by* (e.g. one line per Rg). Pick a parameter in the **+** select next to it to split further:
  *SC* + *RHR* gives one line per pair (SC = 0 · RHR = 100, SC = 0 · RHR = 200, …); *none* removes a
  key. The legend lists the first 8 lines, and any lines after those are grey. **Log X** (<kbd>L</kbd>) helps with geometric current steps.
  Points with a yellow dot have a warning. **Repeats**: shots with the same shot name (S01, S02, …)
  and identical folder parameters, e.g. one setup measured three times into three folders, are
  drawn as one point at the mean with error bars (± σ or min–max, in Y and in the measured
  current) and the single values as small dots; *each shot* turns this off. Clicking such a point
  pins all its shots; hovering shows the single values. A clicked point keeps its tooltip open with
  **Hide folder** (hides all shots of the folder(s) of that point for now), **Open in scope view** and
  **Show in list**; click elsewhere, click the point again or press <kbd>Esc</kbd> to close it. **Double-click** a point to scroll the
  folder list on the left to that shot (its folder opens and the shot flashes), so you can read the
  folder's parameters; the right-click menu has the same as **Show in folder list** for any view.
- **Table**: every shot with its parameters and metrics; click a header to sort. **Copy** gives
  tab-separated text for Excel, **Export CSV** plain SI numbers with units in the header.
  **Collapse repeats** merges shots with the same shot name and folder parameters (as Repeats does
  in the trend plot) into one row: *Runs* gives the number of shots, the current and all metrics
  show mean ± σ (sample standard deviation), and *Folder* the first folder + count (hover for all).
  Clicking such a row pins all its shots. Copy / Export CSV follow it; the CSV then has a σ column
  after each metric.
- **Filter** (above the table, <kbd>/</kbd>): shows only matching shots in the table and both plots
  (Copy / Export CSV too); the pool list strikes the others through. Terms are separated by spaces
  and must all match: `I~10A` (around 10 A, ±10 %), `I~10A±2A`, `I~10A±20%`, `I=8..12A`, `I>5A`,
  `I<=2A`, `~10A` (no key = shot current), `Rg=10`, `Vdc!=24`, `Folder=NOR45A24_Rg10_24V`,
  or plain text that the folder or shot name contains. Unreadable terms turn the box red (hover it to
  see which) and are ignored. <kbd>Esc</kbd> in the box clears it. Colours keep their scale over all shots.

**Open in the scope view**: right-click a shot (pool entry, curve, trend point or table row) and
choose **Open in scope view**, or hover it and press <kbd>O</kbd> (with nothing hovered, <kbd>O</kbd>
opens all pinned shots). The analyzer opens in its own tab (reused next time) with the shot as one
CSV image (all channels), zoomed to the overlay's time window around the selected edge and with
the cursors on its 10 % and 90 % crossings. Its name lists the values (shot, folder parameters,
shot current), e.g. `S20 · 10 · 24 V · 32.4 A (NOR45A24_Rg10_24V)`, and its **Notes** start with
the same values with their keys (`Rg = 10`, `Vdc = 24 V`, `I = 32.4 A`). Opening the same shot
again reuses it and keeps your notes. If nothing happens, allow pop-ups for the page.

**Showing and hiding shots**: the checkboxes in the pool show / hide single shots or whole folders;
this choice is saved with the pool. **Hide** on a folder (or **Hide folder** on a clicked trend point
or in the right-click menu; **Hide** there and <kbd>H</kbd> hide just the shot, <kbd>H</kbd> the pinned
shots, else the hovered one) hides shots only for now:
they leave the plots and the table, get a *hidden* tag in the pool list (click it to show that shot
again), and come back with **Unhide** on the folder, **Unhide all** above the pool list
(<kbd>Shift</kbd>+<kbd>H</kbd>) or a reload. **Collapse repeats** above the pool list merges folders
with identical parameters into one entry (*2 runs*, the folder names under it) with the shots merged
by name (*S05 ×2*, mean current); its checkbox and Hide act on all of them, Edit and × need the
single folders (untick it). **Export pool** saves raw data
and parameters to a `.json` file (drop it onto the page or use **Import pool** on another computer).

**Metrics** (per edge; levels are measured per edge, because the off-state level moves with
current and the on-state level can settle slowly):

| Metric | Definition |
|---|---|
| Levels, swing | median before the edge, and median of the second half of the time until the next edge (or record end) |
| Slew rate 10–90 % / 20–80 % | 0.8 (0.6) × swing / time between the two level crossings |
| Rise / fall time | time between the 10 % and 90 % crossings |
| Peak dv/dt | largest least-squares slope over the *dv/dt window* (default 2 ns) between 10 % and 90 % |
| Overshoot | furthest excursion beyond the final level within the *ringing window* (default 50 ns) after the 50 % crossing, 3-point smoothed |
| Ringing pk-pk | first oscillation after the 50 % crossing: first peak minus the following valley (smoothed; 0 when there is no reversal larger than 2 % of the swing or 5× the noise) |
| Ringing frequency | from the spacing of successive peaks and valleys starting at that first peak (half a period each, up to 4 periods, until the next edge or until the ringing dies out); empty when there is less than one full period |

A **!** badge marks shots with no switching edge, possibly clipped data or a level that did not
settle within the record; hover it for the reason. The windows are set in the **Analysis** box.

## Checking / fixing the calibration

The **Calibration** panel shows every detected value with a badge:
✓ detected and confirmed by two sources, **!** uncertain (check it), ✎ set by you.
All fields are editable (type e.g. `5 ns`, `200 mV`, `2.5 µs`). Use ⌖ to click a channel's
0 level on the image. The **V / A** button next to a scale switches the channel between volts and
amperes (current probe). **Re-detect** discards your edits (for 10 s it turns into **↶ Undo**).

Screenshots from an unknown scope: open *Graticule*, click **Pick grid on image…**, drag a
rectangle over the outer grid border, enter the number of divisions, then set time/div, the time at
the centre, and per channel V/div and 0 level.

Supported layouts: **R&S RTB2004** (1280×824 screenshots, normal and persistence display).

## Notes

The **Notes** card under the calibration holds free text per image (test conditions, probe,
what you saw). It is saved with the image and exported with the session. Merging two CSVs keeps
both notes in the merged view. <kbd>Esc</kbd> leaves the text box.

## Saving

Everything (images, cursors, edits) is saved automatically in the browser and restored the next
time you open `index.html` in the same browser. **Export session** writes everything to a
`.json` file. Import it (or drop it onto the window) on another computer.

Sessions with CSV waveforms can get large (four 320,000-sample LTspice exports: 90 MB). If the
file would be larger than 1 MB, Export asks how to store the waveforms:

| Option | Example (90 MB session) | What you lose |
|---|---|---|
| **Lossless** (default) | 3.8 MB | Nothing the app shows or measures. The original CSV text is not kept (digits beyond float32 precision, columns beyond the 4th, other `.step` runs, original non-uniform time stamps). |
| **Compact, 16 bit** | 0.24 MB | Each channel is rounded to 65,536 levels between its min and max; the dialog lists the max error per channel (here ±0.4 mV on 50 V signals). Imported CSVs keep this as a note in the Display panel. |
| **Original files** | 90 MB | Nothing; the only format older versions of the app can import. |

Smaller sessions are exported as original files without asking.

Press **?** in the app for all shortcuts.
