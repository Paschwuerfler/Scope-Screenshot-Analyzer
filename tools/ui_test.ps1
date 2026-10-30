# UI smoke test: drives the real app in headless Edge/Chrome via CDP.
# Loads the samples (?samples), drags a cursor, nudges with the keyboard, double-clicks,
# switches images, reloads the page and checks that everything was restored. Also CSV docs and
# merged views (two CSVs in one plot: drag a thumbnail onto another, time shift, Align, Ctrl+drag).
# Usage:  powershell -ExecutionPolicy Bypass -File tools\ui_test.ps1 [-ShotDir <folder>]
param([string]$ShotDir = '')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\cdp.ps1"

$fails = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host "  PASS  $name  $detail" } else { Write-Host "  FAIL  $name  $detail"; $script:fails++ }
}
# Screen position (CSS px, page coordinates) of cursor n of the active doc, at mid-grid height.
$cursorPosJs = @'
(n => { const d = App.docs.active(), v = d.view, r = document.getElementById('view').getBoundingClientRect();
  const x = n === 1 ? d.cursors.x1 : d.cursors.x2, g = d.calib.grid;
  return [r.left + v.ox + x * v.scale, r.top + v.oy + (g.top + g.bottom) / 2 * v.scale]; })
'@

$sess = Start-CdpSession 'index.html?samples=4'
try {
  Wait-Cdp $sess 'document.body.dataset.demoReady === "1" && App.docs.list().length === 5 && App.docs.active()' 60
  Check 'demo loaded' $true
  Send-CdpKey $sess 'g' 'KeyG' 71
  Start-Sleep -Milliseconds 300
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_fitgrid.png') }

  # --- drag cursor 1 by +120 screen px
  $x0 = Invoke-CdpJs $sess 'App.docs.active().cursors.x1'
  $scale = Invoke-CdpJs $sess 'App.docs.active().view.scale'
  $p = Invoke-CdpJs $sess "($cursorPosJs)(1)"
  Send-CdpMouse $sess 'mouseMoved' $p[0] $p[1]
  Send-CdpMouse $sess 'mousePressed' $p[0] $p[1]
  for ($k = 1; $k -le 6; $k++) { Send-CdpMouse $sess 'mouseMoved' ($p[0] + 20 * $k) $p[1] }
  Send-CdpMouse $sess 'mouseReleased' ($p[0] + 120) $p[1]
  $x1 = Invoke-CdpJs $sess 'App.docs.active().cursors.x1'
  Check 'drag cursor 1' ([math]::Abs(($x1 - $x0) - 120 / $scale) -lt 1.5) ("moved {0:N1} image px, expected {1:N1}" -f ($x1 - $x0), (120 / $scale))

  # --- keyboard nudge (Shift+Right = +10 px) on selected cursor 1
  Send-CdpKey $sess 'ArrowRight' 'ArrowRight' 39 8
  $x2 = Invoke-CdpJs $sess 'App.docs.active().cursors.x1'
  Check 'shift+right nudge' ([math]::Abs($x2 - $x1 - 10) -lt 0.01) ("{0:N2} -> {1:N2}" -f $x1, $x2)

  # --- double-click right of cursor 2 moves cursor 2 there
  $p2 = Invoke-CdpJs $sess "($cursorPosJs)(2)"
  $tx = $p2[0] + 80
  Send-CdpMouse $sess 'mousePressed' $tx $p2[1] 'left' 1; Send-CdpMouse $sess 'mouseReleased' $tx $p2[1] 'left' 1
  Send-CdpMouse $sess 'mousePressed' $tx $p2[1] 'left' 2; Send-CdpMouse $sess 'mouseReleased' $tx $p2[1] 'left' 2
  $c2 = Invoke-CdpJs $sess 'App.docs.active().cursors.x2'
  $exp = Invoke-CdpJs $sess "(() => { const d = App.docs.active(), v = d.view, r = document.getElementById('view').getBoundingClientRect(); return ($tx - r.left - v.ox) / v.scale; })()"
  Check 'double-click moves cursor 2' ([math]::Abs($c2 - $exp) -lt 1) ("x2={0:N1} expected {1:N1}" -f $c2, $exp)

  # --- readout shows a slope for C4
  $ro = Invoke-CdpJs $sess 'document.querySelector("#readout").innerText'
  Check 'readout has slope' ($ro -match 'V/(ns|µs|ms|s)') (($ro -split "`n" | Select-Object -Last 1))
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_moved.png') }

  # --- navigate to next image and back: cursor kept
  $id4 = Invoke-CdpJs $sess 'App.docs.active().id'
  Send-CdpKey $sess 'ArrowDown' 'ArrowDown' 40
  $id5 = Invoke-CdpJs $sess 'App.docs.active().id'
  Send-CdpKey $sess 'ArrowUp' 'ArrowUp' 38
  $back = Invoke-CdpJs $sess 'App.docs.active().cursors.x1'
  Check 'navigate next/prev keeps cursors' (($id4 -ne $id5) -and ([math]::Abs($back - $x2) -lt 0.01)) "x1=$back"

  # --- rename: double-click the name of a non-active thumbnail, type, Enter
  $np = Invoke-CdpJs $sess '(() => { const r = document.querySelectorAll("#strip-list .thumb-name")[1].getBoundingClientRect(); return [r.left + 10, r.top + r.height / 2]; })()'
  $idRen = Invoke-CdpJs $sess 'App.docs.list()[1].id'
  Send-CdpMouse $sess 'mousePressed' $np[0] $np[1] 'left' 1; Send-CdpMouse $sess 'mouseReleased' $np[0] $np[1] 'left' 1
  Send-CdpMouse $sess 'mousePressed' $np[0] $np[1] 'left' 2; Send-CdpMouse $sess 'mouseReleased' $np[0] $np[1] 'left' 2
  Wait-Cdp $sess 'document.activeElement && document.activeElement.classList.contains("thumb-rename")' 5
  Invoke-CdpJs $sess 'document.activeElement.select()' | Out-Null
  Invoke-Cdp $sess 'Input.insertText' @{ text = 'renamed shot' } | Out-Null
  Send-CdpKey $sess 'Enter' 'Enter' 13
  $nm = Invoke-CdpJs $sess "App.docs.get('$idRen').name"
  $lbl = Invoke-CdpJs $sess 'document.querySelectorAll("#strip-list .thumb-name")[1].textContent'
  Check 'double-click renames image' (($nm -eq 'renamed shot') -and ($lbl -eq 'renamed shot')) "name=$nm label=$lbl"
  # F2 + Escape cancels
  Send-CdpKey $sess 'F2' 'F2' 113
  Invoke-Cdp $sess 'Input.insertText' @{ text = 'nope' } | Out-Null
  Send-CdpKey $sess 'Escape' 'Escape' 27
  $nm2 = Invoke-CdpJs $sess "App.docs.get('$idRen').name"
  $inp = Invoke-CdpJs $sess '!!document.querySelector(".thumb-rename")'
  Check 'F2 + Esc cancels rename' (($nm2 -eq 'renamed shot') -and -not $inp) "name=$nm2"
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_renamed.png') }

  # --- multi-period mode on the ringing sample (image 1)
  $id1 = Invoke-CdpJs $sess 'App.docs.list()[0].id'
  Invoke-CdpJs $sess "App.docs.setActive('$id1')" | Out-Null
  Send-CdpKey $sess 'g' 'KeyG' 71
  # ringing peaks of C1 (local minima of y) in the right 60 % of the grid
  $pk = Invoke-CdpJs $sess @'
(() => { const d = App.docs.active(), m = d.traces.C1.mid, g = d.calib.grid, out = [];
  for (let x = Math.round(g.left + 0.4 * (g.right - g.left)); x < g.right - 30; x++) {
    let ok = !isNaN(m[x]);
    for (let k = -30; ok && k <= 30; k++) if (k && m[x + k] < m[x]) ok = false;
    if (ok && (!out.length || x - out[out.length - 1] > 30)) out.push(x);
  }
  return out; })()
'@
  Invoke-CdpJs $sess "(() => { const d = App.docs.active(); d.cursors.x1 = $($pk[0]); d.cursors.x2 = $($pk[1]); App.docs.touch(d); })()" | Out-Null
  $bp = Invoke-CdpJs $sess '(() => { const r = document.getElementById("tgl-periods").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()'
  Send-CdpMouse $sess 'mousePressed' $bp[0] $bp[1]; Send-CdpMouse $sess 'mouseReleased' $bp[0] $bp[1]
  # drag cursor 2 from peak 1 to peak 3 (screen px)
  $p = Invoke-CdpJs $sess "($cursorPosJs)(2)"
  $sc = Invoke-CdpJs $sess 'App.docs.active().view.scale'
  $tx = $p[0] + ($pk[3] - $pk[1]) * $sc
  Send-CdpMouse $sess 'mouseMoved' $p[0] $p[1]; Send-CdpMouse $sess 'mousePressed' $p[0] $p[1]
  for ($k = 1; $k -le 8; $k++) { Send-CdpMouse $sess 'mouseMoved' ($p[0] + ($tx - $p[0]) * $k / 8) $p[1] }
  Send-CdpMouse $sess 'mouseReleased' $tx $p[1]
  $pr = Invoke-CdpJs $sess '(() => { const d = App.docs.active(), r = App.measure.cursorReadout(d); return { n: r.periods && r.periods.n, f: r.periods && r.periods.freq, dt: r.dt, amp: r.periods && r.periods.channels[0].amp, marks: App.measure.periodMarks(d), on: document.getElementById("tgl-periods").classList.contains("on") }; })()'
  $markErr = [math]::Max([math]::Abs($pr.marks[0] - $pk[1]), [math]::Abs($pr.marks[1] - $pk[2]))
  Check 'multi-period: N, marks on peaks, f = N/dt' (($pr.n -eq 3) -and $pr.on -and ($markErr -lt 6) -and ([math]::Abs($pr.f * [math]::Abs($pr.dt) - 3) -lt 1e-9) -and ($pr.amp -gt 0)) ("N={0} mark err {1:N1} px f={2:N0} Hz amp={3:N2}" -f $pr.n, $markErr, $pr.f, $pr.amp)
  if ($ShotDir) { Start-Sleep -Milliseconds 200; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_periods.png') }
  Send-CdpKey $sess '.' 'Period' 190
  $n4 = Invoke-CdpJs $sess 'App.measure.periodCount(App.docs.active())'
  Send-CdpKey $sess ',' 'Comma' 188
  $n3 = Invoke-CdpJs $sess 'App.measure.periodCount(App.docs.active())'
  Check 'multi-period: . and , step N' (($n4 -eq 4) -and ($n3 -eq 3)) "$n4 then $n3"
  Send-CdpKey $sess '1' 'Digit1' 49
  Send-CdpKey $sess 'ArrowRight' 'ArrowRight' 39 8
  $still = Invoke-CdpJs $sess '!!App.docs.active().cursors.periods'
  Check 'multi-period: small cursor-1 nudge keeps mode' $still
  Invoke-CdpJs $sess "App.docs.setActive('$id4')" | Out-Null

  # --- Notes card: typing saves into the active doc, switching images shows each doc's own text
  Invoke-CdpJs $sess '(() => { const t = document.getElementById("doc-notes"); t.focus(); t.value = "Rg = 10 Ohm\nnoisy probe"; t.dispatchEvent(new Event("input")); t.blur(); return true; })()' | Out-Null
  Invoke-CdpJs $sess "App.docs.setActive('$id1')" | Out-Null
  $nOther = Invoke-CdpJs $sess 'document.getElementById("doc-notes").value'
  Invoke-CdpJs $sess "App.docs.setActive('$id4')" | Out-Null
  $nBack = Invoke-CdpJs $sess 'document.getElementById("doc-notes").value'
  Check 'notes are per image' (($nOther -ne $nBack) -and ($nBack -eq "Rg = 10 Ohm`nnoisy probe")) "other='$nOther'"

  # --- reload: session restored from IndexedDB
  Start-Sleep -Milliseconds 800   # let debounced save run
  # navigate to the plain URL (a reload would keep ?samples and re-import the samples)
  $plain = Invoke-CdpJs $sess 'location.href.split("?")[0]'
  Invoke-Cdp $sess 'Page.navigate' @{ url = $plain } | Out-Null
  Start-Sleep -Milliseconds 500
  Wait-Cdp $sess 'window.App && App.docs && App.docs.list().length === 5' 30
  $rid = Invoke-CdpJs $sess 'App.docs.active() && App.docs.active().id'
  $rx = Invoke-CdpJs $sess 'App.docs.active().cursors.x1'
  Check 'reload restores session' (($rid -eq $id4) -and ([math]::Abs($rx - $x2) -lt 0.01)) "active=$rid x1=$rx"
  $rn = Invoke-CdpJs $sess "App.docs.get('$idRen') && App.docs.get('$idRen').name"
  Check 'reload keeps renamed image' ($rn -eq 'renamed shot') "name=$rn"
  $rnotes = Invoke-CdpJs $sess 'document.getElementById("doc-notes").value'
  Check 'reload keeps notes' ($rnotes -eq "Rg = 10 Ohm`nnoisy probe") $rnotes
  Invoke-CdpJs $sess "App.docs.setActive('$id1')" | Out-Null
  $rn3 = Invoke-CdpJs $sess 'App.measure.periodCount(App.docs.active())'
  Check 'reload keeps multi-period mode' ($rn3 -eq 3) "N=$rn3"
  $half = Invoke-CdpJs $sess 'App.docs.active().cursors.periods.p0 * 0.6'
  Invoke-CdpJs $sess "App.view.nudge($half)" | Out-Null
  $off = Invoke-CdpJs $sess '!App.docs.active().cursors.periods && !document.getElementById("tgl-periods").classList.contains("on")'
  Check 'moving cursor 1 to another cycle ends multi-period mode' $off
  if ($ShotDir) { Start-Sleep -Milliseconds 300; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_restored.png') }
} finally { Stop-CdpSession $sess }

# ---------------------------------------------------------------- CSV waveforms (series docs)
$sess = Start-CdpSession 'index.html'
try {
  Wait-Cdp $sess 'window.App && App.docs && document.readyState === "complete"' 30
  # load through a real file input, like the "Open files" picker
  Invoke-CdpJs $sess '(() => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.id = "tfile"; i.style.display = "none"; i.onchange = () => App.loaders.loadFiles([...i.files]); document.body.appendChild(i); })()' | Out-Null
  $root = Invoke-Cdp $sess 'DOM.getDocument' @{}
  $node = Invoke-Cdp $sess 'DOM.querySelector' @{ nodeId = $root.root.nodeId; selector = '#tfile' }
  $csvs = @('samples\csv\WFM05.csv', 'samples\csv\50A-48_28V-1_425A.CSV', 'samples\csv\RealDecoupling.txt') | ForEach-Object { (Resolve-Path (Join-Path (Split-Path $PSScriptRoot -Parent) $_)).Path }
  Invoke-Cdp $sess 'DOM.setFileInputFiles' @{ nodeId = $node.nodeId; files = $csvs } | Out-Null
  Wait-Cdp $sess 'App.docs.list().length === 3' 60
  # LTspice export: tab-separated, "time V(out) V(vcc)", adaptive (non-uniform) time steps
  $lt = Invoke-CdpJs $sess '(() => { const d = App.docs.list().find(x => x.name.startsWith("RealDecoupling")), s = d.series, c = s.cols[1]; return { ch: s.cols.map(c => c.id + ":" + c.name + ":" + c.unit).join(","), t1: s.t0 + (s.n - 1) * s.dt, n: s.n, vEnd: c.v[s.n - 1], resampled: d.notes.some(x => /resampled/.test(x)) }; })()'
  Check 'LTspice .txt parsed (SPICE names, units, span, resampled)' (($lt.ch -eq 'C1:V(out):V,C2:V(vcc):V') -and ([math]::Abs($lt.t1 - 4e-7) -lt 1e-15) -and $lt.resampled -and ([math]::Abs($lt.vEnd - 29.80548) -lt 1e-4)) ("n={0} {1} end={2}" -f $lt.n, $lt.ch, $lt.vEnd)
  $nm = Invoke-CdpJs $sess '(() => { const n = p => JSON.stringify(App.docs.list().find(x => x.name.startsWith(p)).chNames); return n("RealDecoupling") + "|" + n("50A"); })()'
  Check 'channel names from CSV headers (SPICE named, C1..C4 not)' ($nm -eq '{"C1":"Vout","C2":"Vvcc"}|{}') $nm
  $info = Invoke-CdpJs $sess '(() => { const d = App.docs.list().find(x => x.name.startsWith("50A")); App.docs.setActive(d.id); const s = d.series; return { id: d.id, n: s.n, dt: s.dt, ch: s.cols.map(c => c.id + ":" + c.unit).join(","), v: s.cols[1].v[5] }; })()'
  Check 'CSV parsed (4 channels, units, dt)' (($info.n -eq 129304) -and ($info.ch -eq 'C1:V,C2:A,C3:A,C4:A') -and ([math]::Abs($info.dt - 9.28e-7) -lt 1e-10)) ("n={0} dt={1} {2}" -f $info.n, $info.dt, $info.ch)
  Start-Sleep -Milliseconds 300
  $ovShown = Invoke-CdpJs $sess 'document.body.classList.contains("series") && document.getElementById("overview").clientHeight > 20'
  Check 'overview bar shown for CSV' $ovShown

  # probe toggles: default one channel, clicking C2 adds it
  $p0 = Invoke-CdpJs $sess 'App.measure.cursorReadout(App.docs.active()).channels.map(c => c.id).join(",")'
  $cb = Invoke-CdpJs $sess '(() => { const r = document.querySelector("#probe-btns [data-probe=C2]").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()'
  Send-CdpMouse $sess 'mousePressed' $cb[0] $cb[1]; Send-CdpMouse $sess 'mouseReleased' $cb[0] $cb[1]
  $p1 = Invoke-CdpJs $sess 'App.measure.cursorReadout(App.docs.active()).channels.map(c => c.id).join(",") + "|" + document.querySelector("#probe-btns [data-probe=C2]").classList.contains("on")'
  Check 'probe chips: default one channel, click adds C2' (($p0 -eq 'C1') -and ($p1 -eq 'C1,C2|true')) "$p0 -> $p1"
  $ax1 = Invoke-CdpJs $sess 'App.series.axisChannel(App.docs.active()) + "|" + document.querySelector("#calib [data-axis].axis").dataset.axis'
  Check 'y axis labels follow the probe switched on last' ($ax1 -eq 'C2|C2') $ax1
  $rate = Invoke-CdpJs $sess 'document.querySelector("#calib .rate").textContent + " | " + document.getElementById("status-doc").textContent'
  Check 'sample rate shown' ($rate -match '1\.078 MSa/s.*1\.078 MSa/s') $rate

  # channel handle: drag C1 down 50 px (offset), wheel up over it (finer scale, 0 level kept)
  $hp = Invoke-CdpJs $sess '(() => { const d = App.docs.active(), r = document.getElementById("view").getBoundingClientRect(), ky = (r.height - 74) / 800; return [r.left + 17, r.top + 34 + d.calib.channels.C1.zeroY * ky, ky, d.calib.channels.C1.zeroY]; })()'
  Send-CdpMouse $sess 'mouseMoved' $hp[0] $hp[1]; Send-CdpMouse $sess 'mousePressed' $hp[0] $hp[1]
  for ($k = 1; $k -le 5; $k++) { Send-CdpMouse $sess 'mouseMoved' $hp[0] ($hp[1] + 10 * $k) }
  Send-CdpMouse $sess 'mouseReleased' $hp[0] ($hp[1] + 50)
  $z1 = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C1.zeroY'
  $zExp = [math]::Round(($hp[3] + 50 / $hp[2]) / 100) * 100
  Check 'drag channel handle: offset snaps to division' ([math]::Abs($z1 - $zExp) -lt 1e-9) ("zeroY {0:N1} -> {1:N1} (expected {2})" -f $hp[3], $z1, $zExp)
  $ax2 = Invoke-CdpJs $sess 'App.series.axisChannel(App.docs.active())'
  Check 'y axis labels follow the dragged handle' ($ax2 -eq 'C1') $ax2
  $vd0 = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C1.vdiv'
  Invoke-Cdp $sess 'Input.dispatchMouseEvent' @{ type = 'mouseWheel'; x = $hp[0]; y = ($hp[1] + 50); deltaX = 0; deltaY = -100 } | Out-Null
  Start-Sleep -Milliseconds 100
  $vz = Invoke-CdpJs $sess '(() => { const c = App.docs.active().calib.channels.C1; return [c.vdiv, c.zeroY]; })()'
  Check 'wheel on handle: 1-2-5 step, 0 level kept' (([math]::Abs($vz[0] - $vd0 / 2) -lt 1e-12) -and ([math]::Abs($vz[1] - $z1) -lt 1e-9)) "vdiv $vd0 -> $($vz[0])"
  # hovering a handle: resize cursor + tooltip (check the screenshot)
  Send-CdpMouse $sess 'mouseMoved' ($hp[0] - 6) ($hp[1] + 50)
  $hc = Invoke-CdpJs $sess 'document.getElementById("view").style.cursor'
  Check 'hover on handle (grip side) shows resize cursor' ($hc -eq 'ns-resize') $hc
  if ($ShotDir) { Start-Sleep -Milliseconds 150; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_handle.png') }
  # scale/div field: wheel down = coarser, ArrowUp = coarser
  $fi = Invoke-CdpJs $sess '(() => { const r = document.querySelector("#calib [data-vdiv=C3]").getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2, App.docs.active().calib.channels.C3.vdiv]; })()'
  Invoke-Cdp $sess 'Input.dispatchMouseEvent' @{ type = 'mouseWheel'; x = $fi[0]; y = $fi[1]; deltaX = 0; deltaY = 100 } | Out-Null
  Start-Sleep -Milliseconds 100
  Send-CdpKey $sess 'ArrowUp' 'ArrowUp' 38
  $vf = Invoke-CdpJs $sess '[App.docs.active().calib.channels.C3.vdiv, document.querySelector("#calib [data-vdiv=C3]").value]'
  Check 'scale field: wheel + arrow step 1-2-5' (($fi[2] -eq 10) -and ($vf[0] -eq 50)) "$($fi[2]) -> $($vf[0]) ($($vf[1]))"

  # exact values: cursor on sample 5 reads the CSV value
  Invoke-CdpJs $sess '(() => { const d = App.docs.active(); d.cursors.x1 = 5; App.docs.touch(d); })()' | Out-Null
  $v5 = Invoke-CdpJs $sess '(() => { const d = App.docs.active(); d.cursors.probe = ["C2"]; return App.measure.cursorReadout(d).channels[0].v1; })()'
  Check 'cursor reads exact sample value' ([math]::Abs($v5 - $info.v) -lt 1e-9) "v=$v5 csv=$($info.v)"

  # wheel zoom: time only, anchored at the pointer
  $pv = Invoke-CdpJs $sess '(() => { const r = document.getElementById("view").getBoundingClientRect(); return [r.left + r.width * 0.3, r.top + r.height / 2]; })()'
  $before = Invoke-CdpJs $sess "(() => { const w = App.view.getWindow(App.docs.active()), r = document.getElementById('view').getBoundingClientRect(); return { w: w.xb - w.xa, i: w.xa + ($($pv[0]) - r.left - 40) / (r.width - 54) * (w.xb - w.xa) }; })()"
  for ($k = 0; $k -lt 3; $k++) { Invoke-Cdp $sess 'Input.dispatchMouseEvent' @{ type = 'mouseWheel'; x = $pv[0]; y = $pv[1]; deltaX = 0; deltaY = -300 } | Out-Null }
  Start-Sleep -Milliseconds 200
  $after = Invoke-CdpJs $sess "(() => { const w = App.view.getWindow(App.docs.active()), r = document.getElementById('view').getBoundingClientRect(); return { w: w.xb - w.xa, i: w.xa + ($($pv[0]) - r.left - 40) / (r.width - 54) * (w.xb - w.xa) }; })()"
  $td = Invoke-CdpJs $sess 'document.querySelector("#calib [data-w=tdiv]").value'
  Check 'time/div is a 1-2-5 value after zoom' ($td -match '^(1|2|5|10|20|50|100|200|500) [mµn]?s$') $td
  Check 'wheel zooms time axis around pointer' (($after.w -lt $before.w / 3) -and ([math]::Abs($after.i - $before.i) -lt 2)) ("width {0:N0} -> {1:N0} samples, anchor {2:N1} -> {3:N1}" -f $before.w, $after.w, $before.i, $after.i)
  if ($ShotDir) { Start-Sleep -Milliseconds 200; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_zoom.png') }

  # overview: drag the window by +100 px, then its right edge by +60 px, then double-click = all
  $ov = Invoke-CdpJs $sess '(() => { const r = document.getElementById("overview").getBoundingClientRect(), d = App.docs.active(), w = App.view.getWindow(d); return { l: r.left, t: r.top, w: r.width, h: r.height, xa: w.xa, xb: w.xb, n: d.width - 1 }; })()'
  $ax = $ov.l + ($ov.xa + $ov.xb) / 2 / $ov.n * $ov.w; $ay = $ov.t + $ov.h / 2
  Send-CdpMouse $sess 'mouseMoved' $ax $ay; Send-CdpMouse $sess 'mousePressed' $ax $ay
  for ($k = 1; $k -le 5; $k++) { Send-CdpMouse $sess 'mouseMoved' ($ax + 20 * $k) $ay }
  Send-CdpMouse $sess 'mouseReleased' ($ax + 100) $ay
  $w1 = Invoke-CdpJs $sess 'App.view.getWindow(App.docs.active())'
  $exp = 100 / $ov.w * $ov.n
  Check 'overview drag pans window' (([math]::Abs(($w1.xa - $ov.xa) - $exp) -lt $ov.n / $ov.w * 2) -and ([math]::Abs(($w1.xb - $w1.xa) - ($ov.xb - $ov.xa)) -lt 1)) ("moved {0:N0} samples, expected {1:N0}" -f ($w1.xa - $ov.xa), $exp)
  $bx = $ov.l + $w1.xb / $ov.n * $ov.w
  Send-CdpMouse $sess 'mouseMoved' $bx $ay; Send-CdpMouse $sess 'mousePressed' $bx $ay
  for ($k = 1; $k -le 3; $k++) { Send-CdpMouse $sess 'mouseMoved' ($bx + 20 * $k) $ay }
  Send-CdpMouse $sess 'mouseReleased' ($bx + 60) $ay
  $w2 = Invoke-CdpJs $sess 'App.view.getWindow(App.docs.active())'
  Check 'overview edge drag resizes window' (([math]::Abs($w2.xa - $w1.xa) -lt 1) -and ([math]::Abs(($w2.xb - $w1.xb) - 60 / $ov.w * $ov.n) -lt $ov.n / $ov.w * 2)) ("xb {0:N0} -> {1:N0}" -f $w1.xb, $w2.xb)
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_overview.png') }
  Send-CdpMouse $sess 'mousePressed' $ax $ay 'left' 1; Send-CdpMouse $sess 'mouseReleased' $ax $ay 'left' 1
  Send-CdpMouse $sess 'mousePressed' $ax $ay 'left' 2; Send-CdpMouse $sess 'mouseReleased' $ax $ay 'left' 2
  $w3 = Invoke-CdpJs $sess 'App.view.getWindow(App.docs.active())'
  Check 'overview double-click shows all' (($w3.xa -eq 0) -and ($w3.xb -eq $ov.n)) "$($w3.xa)..$($w3.xb)"

  # overview: drag cursor 2 by -80 px
  $c2 = Invoke-CdpJs $sess 'App.docs.active().cursors.x2'
  $cx = $ov.l + $c2 / $ov.n * $ov.w
  Send-CdpMouse $sess 'mouseMoved' $cx $ay; Send-CdpMouse $sess 'mousePressed' $cx $ay
  for ($k = 1; $k -le 4; $k++) { Send-CdpMouse $sess 'mouseMoved' ($cx - 20 * $k) $ay }
  Send-CdpMouse $sess 'mouseReleased' ($cx - 80) $ay
  $c2b = Invoke-CdpJs $sess 'App.docs.active().cursors.x2'
  Check 'overview: drag cursor 2' ([math]::Abs(($c2 - $c2b) - 80 / $ov.w * $ov.n) -lt $ov.n / $ov.w) ("x2 {0:N0} -> {1:N0}" -f $c2, $c2b)

  # splitter: drag the stage/panel border 120 px to the left -> panel 120 px wider
  $sp = Invoke-CdpJs $sess '(() => { const r = document.getElementById("splitter").getBoundingClientRect(); return [r.left + r.width / 2, r.top + 300, document.querySelector(".panel").getBoundingClientRect().width]; })()'
  Send-CdpMouse $sess 'mouseMoved' $sp[0] $sp[1]; Send-CdpMouse $sess 'mousePressed' $sp[0] $sp[1]
  for ($k = 1; $k -le 4; $k++) { Send-CdpMouse $sess 'mouseMoved' ($sp[0] - 30 * $k) $sp[1] }
  Send-CdpMouse $sess 'mouseReleased' ($sp[0] - 120) $sp[1]
  $pw = Invoke-CdpJs $sess 'document.querySelector(".panel").getBoundingClientRect().width'
  Check 'splitter widens the panel' ([math]::Abs(($pw - $sp[2]) - 120) -lt 3) ("{0:N0} -> {1:N0} px" -f $sp[2], $pw)

  # display: change C2 scale, centre value is kept
  $c0 = Invoke-CdpJs $sess '(() => { const c = App.docs.active().calib; return App.calib.vAt(c, "C2", 400); })()'
  Invoke-CdpJs $sess '(() => { const i = document.querySelector("#calib [data-vdiv=C2]"); i.value = "20 A"; i.dispatchEvent(new Event("change", { bubbles: true })); })()' | Out-Null
  $c1 = Invoke-CdpJs $sess '(() => { const c = App.docs.active().calib; return [c.channels.C2.vdiv, App.calib.vAt(c, "C2", 400)]; })()'
  # display: name C2, label shows in readout, legend and status bar
  Invoke-CdpJs $sess '(() => { const i = document.querySelector("#calib [data-chname=C2]"); i.value = " Load current "; i.dispatchEvent(new Event("change", { bubbles: true })); })()' | Out-Null
  Start-Sleep -Milliseconds 100
  $lbl = Invoke-CdpJs $sess '[...document.querySelectorAll("#readout .chip")].map(e => e.textContent).join(",")'
  Check 'channel name shown in readout' ($lbl -eq 'C2 (Load current)') $lbl
  $cc = Invoke-CdpJs $sess '(() => { const r = document.querySelector("#calib [data-axis=C4]").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()'
  Send-CdpMouse $sess 'mousePressed' $cc[0] $cc[1]; Send-CdpMouse $sess 'mouseReleased' $cc[0] $cc[1]
  Start-Sleep -Milliseconds 100
  $ax3 = Invoke-CdpJs $sess 'App.series.axisChannel(App.docs.active()) + "|" + document.querySelector("#calib [data-axis].axis").dataset.axis'
  Check 'y axis labels: click on channel chip in Display' ($ax3 -eq 'C4|C4') $ax3
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_axis.png') }
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_names.png') }
  Check 'display: scale change keeps centre value' (($c1[0] -eq 20) -and ([math]::Abs($c1[1] - $c0) -lt 1e-9)) "vdiv=$($c1[0]) centre $c0 -> $($c1[1])"

  # screenshot mode (S): bigger canvas text and margins, handles still hit at their new place
  Invoke-CdpJs $sess 'document.activeElement && document.activeElement.blur()' | Out-Null
  Send-CdpKey $sess 's' 'KeyS' 83
  Start-Sleep -Milliseconds 150
  $bt = Invoke-CdpJs $sess '(() => { const d = App.docs.active(), r = document.getElementById("view").getBoundingClientRect(); return { on: App.ui.prefs.bigText && document.getElementById("tgl-bigtext").classList.contains("on"), x: r.left + 10, y: r.top + 34 * 1.8 + d.calib.channels.C1.zeroY * (r.height - 74 * 1.8) / 800 }; })()'
  Send-CdpMouse $sess 'mouseMoved' $bt.x $bt.y
  $bc = Invoke-CdpJs $sess 'document.getElementById("view").style.cursor'
  Check 'screenshot mode on (S), scaled handle still hit' ($bt.on -and ($bc -eq 'ns-resize')) "on=$($bt.on) cursor=$bc"
  if ($ShotDir) { Start-Sleep -Milliseconds 150; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_bigtext.png') }
  $ci = Invoke-CdpJs $sess 'App.view.toBlob().then(b => createImageBitmap(b)).then(i => [i.width, i.height, document.getElementById("view").width, !!document.getElementById("btn-copyimg")])'
  Check 'copy image: PNG of the plot at canvas resolution' (($ci[0] -eq $ci[2]) -and ($ci[1] -gt 200) -and $ci[3]) "$($ci[0])x$($ci[1])"
  Send-CdpKey $sess 's' 'KeyS' 83
  $bo = Invoke-CdpJs $sess 'App.ui.prefs.bigText'
  Check 'screenshot mode off again' (-not $bo) "$bo"

  # Auto scale -> button turns into Undo -> restores the manual scale
  function Click-Sel($sel) { $p = Invoke-CdpJs $sess "(() => { const r = document.querySelector('$sel').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"; Send-CdpMouse $sess 'mousePressed' $p[0] $p[1]; Send-CdpMouse $sess 'mouseReleased' $p[0] $p[1]; Start-Sleep -Milliseconds 150 }
  $u0 = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C2.vdiv'
  Click-Sel '#btn-redetect'
  $u1 = Invoke-CdpJs $sess '[App.docs.active().calib.channels.C2.vdiv, !!document.getElementById("btn-undo"), !document.getElementById("btn-redetect")]'
  Click-Sel '#btn-undo'
  $u2 = Invoke-CdpJs $sess '[App.docs.active().calib.channels.C2.vdiv, !!document.getElementById("btn-redetect")]'
  Check 'Auto scale offers Undo, Undo restores manual scale' (($u1[0] -ne $u0) -and $u1[1] -and $u1[2] -and ($u2[0] -eq $u0) -and $u2[1]) "C2 $u0 -> $($u1[0]) -> $($u2[0])"
  # unit button: C3 (A) -> V, readout + axis follow, Auto scale keeps it, Enter on the focused button flips back
  Invoke-CdpJs $sess '(() => { const d = App.docs.active(); d.cursors.probe = ["C3"]; App.docs.touch(d, "calib"); })()' | Out-Null
  Click-Sel '#calib [data-unit=C3]'
  $un = Invoke-CdpJs $sess '[App.docs.active().calib.channels.C3.unit, document.querySelector("#calib [data-unit=C3]").textContent, App.measure.cursorReadout(App.docs.active()).channels[0].unit, document.activeElement.dataset.unit || ""]'
  Click-Sel '#btn-redetect'
  $ua = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C3.unit'
  Click-Sel '#btn-undo'
  Invoke-CdpJs $sess 'document.querySelector("#calib [data-unit=C3]").focus()' | Out-Null
  Invoke-Cdp $sess 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Enter'; code = 'Enter'; windowsVirtualKeyCode = 13; text = [string][char]13 } | Out-Null
  Invoke-Cdp $sess 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = 'Enter'; code = 'Enter'; windowsVirtualKeyCode = 13 } | Out-Null
  Start-Sleep -Milliseconds 100
  $ub = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C3.unit'
  Check 'unit button flips A <-> V (readout, button, Auto scale keeps it, keyboard)' (($un -join ',') -eq 'V,V,V,C3' -and $ua -eq 'V' -and $ub -eq 'A') "$($un -join ',') autoscale=$ua back=$ub"
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_unit.png') }

  # copy display settings from the 50A CSV, paste into WFM05 (C1 in V), undo
  Click-Sel '#btn-copydisp'
  $src = Invoke-CdpJs $sess '(() => { const c = App.docs.active().calib.channels.C1; return [c.vdiv, c.zeroY]; })()'
  Invoke-CdpJs $sess 'App.docs.setActive(App.docs.list().find(x => x.name.startsWith("WFM05")).id)' | Out-Null
  Start-Sleep -Milliseconds 150
  $w0 = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C1.vdiv'
  Click-Sel '#btn-pastedisp'
  $w1 = Invoke-CdpJs $sess '(() => { const c = App.docs.active().calib.channels.C1; return [c.vdiv, c.zeroY, !!document.getElementById("btn-undo")]; })()'
  Check 'paste display settings into another CSV' (($w1[0] -eq $src[0]) -and ([math]::Abs($w1[1] - $src[1]) -lt 1e-9) -and $w1[2]) "C1 $w0 -> $($w1[0])"
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_paste.png') }
  Click-Sel '#btn-undo'
  $w2 = Invoke-CdpJs $sess 'App.docs.active().calib.channels.C1.vdiv'
  Check 'undo paste' ($w2 -eq $w0) "C1 -> $w2"
  Invoke-CdpJs $sess 'App.docs.setActive(App.docs.list().find(x => x.name.startsWith("50A")).id)' | Out-Null

  # reload restores series docs
  Start-Sleep -Milliseconds 900
  Invoke-Cdp $sess 'Page.reload' @{} | Out-Null
  Start-Sleep -Milliseconds 500
  Wait-Cdp $sess 'window.App && App.docs && App.docs.list().length === 3 && App.docs.active()' 30
  $rs = Invoke-CdpJs $sess '(() => { const d = App.docs.active(); return { kind: d.kind, n: d.series && d.series.n, vdiv: d.calib.channels.C2.vdiv, name: d.chNames.C2, series: document.body.classList.contains("series") }; })()'
  Check 'reload restores CSV doc (incl. channel name)' (($rs.kind -eq 'series') -and ($rs.n -eq 129304) -and ($rs.vdiv -eq 20) -and ($rs.name -eq 'Load current') -and $rs.series) "kind=$($rs.kind) n=$($rs.n) vdiv=$($rs.vdiv) name=$($rs.name)"
  $pw2 = Invoke-CdpJs $sess 'document.querySelector(".panel").getBoundingClientRect().width'
  Check 'reload keeps panel width' ([math]::Abs($pw2 - $pw) -lt 2) ("{0:N0} px" -f $pw2)
  if ($ShotDir) { Start-Sleep -Milliseconds 300; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_restored.png') }

  # export > 1 MB: Export session opens the format dialog (Esc = cancel, nothing downloaded)
  Invoke-CdpJs $sess 'document.querySelector("[data-act=export]").click()' | Out-Null
  Wait-Cdp $sess 'document.getElementById("export-dlg").open' 60
  $dl = Invoke-CdpJs $sess '[...document.querySelectorAll("#export-dlg [data-size]")].map(e => e.dataset.size + "=" + e.textContent).join(" ") + " | " + document.getElementById("exp-err").innerText.replace(/\n/g, "; ")'
  Check 'export > 1 MB opens the format dialog with sizes and errors' (($dl -match 'lossless=[\d.]+ MB') -and ($dl -match 'compact=[\d.]+ kB') -and ($dl -match 'exact=[\d.]+ MB') -and ($dl -match '\u00B1')) $dl
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_export_dialog.png') }
  Send-CdpKey $sess 'Escape' 'Escape' 27
  Start-Sleep -Milliseconds 100
  Check 'Esc closes the export dialog' (-not (Invoke-CdpJs $sess 'document.getElementById("export-dlg").open'))

  # export formats round trip: lossless = bit-exact, 16 bit within the reported error + note
  $rt = Invoke-CdpJs $sess @'
(async () => {
  const src = App.docs.list().slice(), out = {};
  for (const mode of ['exact', 'lossless', 'compact']) {
    const e = await App.docs.exportSession(mode), n0 = App.docs.list().length;
    await App.docs.importSession(new File([e.blob], mode + '.json'));
    const imp = App.docs.list().slice(n0);
    let maxDiff = 0, maxRel = 0, notes = true;
    src.forEach((d, k) => {
      const a = d.series, b = imp[k].series;
      if (b.n !== a.n || b.t0 !== a.t0 || b.dt !== a.dt) maxDiff = Infinity;
      a.cols.forEach((c, j) => {
        let m = 0; for (let i = 0; i < a.n; i++) m = Math.max(m, Math.abs(c.v[i] - b.cols[j].v[i]));
        maxDiff = Math.max(maxDiff, m); maxRel = Math.max(maxRel, m / ((c.max - c.min) || 1));
      });
      if (mode === 'compact') notes = notes && /16-bit/.test(imp[k].notes[0]) && /16-bit/.test(imp[k].series.notes[0]);
    });
    out[mode] = { size: e.blob.size, lossy: e.lossy.length, maxDiff, maxRel, notes };
    for (const d of imp) await App.docs.remove(d.id);
  }
  return out;
})()
'@
  Check 'export original files: exact round trip' ($rt.exact.maxDiff -eq 0) ("{0:N0} bytes" -f $rt.exact.size)
  Check 'export lossless: bit-exact samples, smaller' (($rt.lossless.maxDiff -eq 0) -and ($rt.lossless.size -lt $rt.exact.size / 2) -and ($rt.lossless.lossy -eq 0)) ("{0:N0} bytes" -f $rt.lossless.size)
  Check 'export 16 bit: error <= half a level, note on every CSV, smallest' (($rt.compact.maxRel -le 0.5 / 65535 + 1e-6) -and $rt.compact.notes -and ($rt.compact.lossy -eq 3) -and ($rt.compact.size -lt $rt.lossless.size)) ("{0:N0} bytes, max error {1:E2} of range" -f $rt.compact.size, $rt.compact.maxRel)
} finally { Stop-CdpSession $sess }

# ---------------------------------------------------------------- merged views (two CSVs in one plot)
$sess = Start-CdpSession 'index.html'
$projDir = Split-Path $PSScriptRoot -Parent
try {
  Wait-Cdp $sess 'window.App && App.docs && document.readyState === "complete"' 30
  Invoke-CdpJs $sess 'App.docs.clear()' | Out-Null
  Invoke-CdpJs $sess '(() => { const i = document.createElement("input"); i.type = "file"; i.multiple = true; i.id = "tfile"; i.style.display = "none"; i.onchange = () => App.loaders.loadFiles([...i.files]); document.body.appendChild(i); })()' | Out-Null
  $root = Invoke-Cdp $sess 'DOM.getDocument' @{}
  $node = Invoke-Cdp $sess 'DOM.querySelector' @{ nodeId = $root.root.nodeId; selector = '#tfile' }
  $csvs = @('samples\csv\RealDecoupling.txt', 'samples\csv\WFM05.csv') | ForEach-Object { (Resolve-Path (Join-Path $projDir $_)).Path }
  Invoke-Cdp $sess 'DOM.setFileInputFiles' @{ nodeId = $node.nodeId; files = $csvs } | Out-Null
  Wait-Cdp $sess 'App.docs.list().length === 2 && App.docs.list().every(d => d.thumbUrl)' 60
  Start-Sleep -Milliseconds 300

  # drag the WFM05 thumbnail onto the RealDecoupling one -> merge dialog
  $pos = Invoke-CdpJs $sess '[...document.querySelectorAll("#strip-list .thumb img")].map(e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })'
  $a = $pos[1]; $b = $pos[0]
  Send-CdpMouse $sess 'mouseMoved' $a[0] $a[1]
  Send-CdpMouse $sess 'mousePressed' $a[0] $a[1]
  for ($k = 1; $k -le 8; $k++) { Send-CdpMouse $sess 'mouseMoved' $a[0] ($a[1] + ($b[1] - $a[1]) * $k / 8) }
  $hl = Invoke-CdpJs $sess '!!document.querySelector("#strip-list .thumb.merge-target:not(.bad)") && !!document.querySelector(".thumb-ghost")'
  Check 'thumbnail drag highlights the merge target' $hl
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_merge_drag.png') }
  Send-CdpMouse $sess 'mouseReleased' $b[0] $b[1]
  Start-Sleep -Milliseconds 150
  $dlg = Invoke-CdpJs $sess '(() => { const d = document.getElementById("merge-dlg"); return { open: d.open, rows: d.querySelectorAll("#mg-rows tr").length, used: d.querySelectorAll("[data-muse]:checked").length, slots: [...d.querySelectorAll("[data-mslot]")].map(s => s.value).join(","), tgt: document.getElementById("mg-tgt").selectedOptions[0].text, ghost: !!document.querySelector(".thumb-ghost") }; })()'
  Check 'drop opens the merge dialog (3 channels, C1..C3)' ($dlg.open -and ($dlg.rows -eq 3) -and ($dlg.used -eq 3) -and ($dlg.slots -eq 'C1,C2,C3') -and ($dlg.tgt -match 'RealDecoupling') -and -not $dlg.ghost) ("rows={0} used={1} slots={2} into={3}" -f $dlg.rows, $dlg.used, $dlg.slots, $dlg.tgt)
  if ($ShotDir) { Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_merge_dialog.png') }
  Invoke-CdpJs $sess 'document.querySelector("#merge-dlg [data-act=ok]").click()' | Out-Null
  Wait-Cdp $sess 'App.docs.list().length === 3 && App.docs.active().parts' 30
  $m = Invoke-CdpJs $sess '(() => { const d = App.docs.active(), src = App.docs.list().find(x => x.name.startsWith("WFM05")), s = d.series; const t = src.series.t0 + 734.4 * src.series.dt; const x = (t - s.t0) / s.dt; return { parts: d.parts.length, ids: s.cols.map(c => c.id).join(","), names: JSON.stringify(d.chNames), v: App.series.valueAt(s, "C3", x), v0: App.series.valueAt(src.series, "C1", 734.4), idx: App.docs.list().indexOf(d), recs: document.querySelectorAll("#calib [data-shift]").length, ref: d.parts[0].shift }; })()'
  Check 'merged view: 2 recordings, C1..C3, one time offset, values from the source samples' (($m.parts -eq 2) -and ($m.ids -eq 'C1,C2,C3') -and ($null -ne $m.v0) -and ([math]::Abs($m.v - $m.v0) -lt 1e-6) -and ($m.idx -eq 1) -and ($m.recs -eq 1) -and ($m.ref -eq 0) -and ($m.names -eq '{"C1":"Vout","C2":"Vvcc","C3":"WFM05 C1"}')) ("ids={0} names={1} v={2} src={3}" -f $m.ids, $m.names, $m.v, $m.v0)

  # time shift typed into the Recordings row: the WFM05 curve moves by exactly that
  Invoke-CdpJs $sess '(() => { const i = document.querySelector("#calib [data-shift=\"1\"]"); i.value = "5 ns"; i.dispatchEvent(new Event("change", { bubbles: true })); })()' | Out-Null
  $sh = Invoke-CdpJs $sess '(() => { const d = App.docs.active(), src = App.docs.list().find(x => x.name.startsWith("WFM05")), s = d.series; const t = src.series.t0 + 734.4 * src.series.dt + 5e-9; return { shift: d.parts[1].shift, v: App.series.valueAt(s, "C3", (t - s.t0) / s.dt), v0: App.series.valueAt(src.series, "C1", 734.4) }; })()'
  Check 'typed time shift moves the recording' (([math]::Abs($sh.shift - 5e-9) -lt 1e-15) -and ($null -ne $sh.v0) -and ([math]::Abs($sh.v - $sh.v0) -lt 1e-6)) ("shift={0} v={1} src={2}" -f $sh.shift, $sh.v, $sh.v0)

  # Align at cursors, both cursor orders: WFM05 merged with a copy of itself, the copy 5 ns late,
  # one cursor on the edge of each. Align must bring the offset back to 0 either way; undo restores
  # offset and cursors. (Runs on its own merged view, removed again afterwards.)
  $al = Invoke-CdpJs $sess @'
(async () => {
  const keep = App.docs.active(), src = App.docs.list().find(x => x.name === 'WFM05.csv');
  const copy = await App.docs.addSeries(src.blob, 'WFM05 copy.csv');
  App.ui.openMerge(copy.id, src.id);
  document.querySelector('#merge-dlg [data-act=ok]').click();
  for (let k = 0; k < 50 && !(App.docs.active().parts && App.docs.active() !== keep); k++) await new Promise(r => setTimeout(r, 50));
  const d = App.docs.active(), c = () => d.calib, s0 = src.series.cols[0], half = (s0.min + s0.max) / 2;
  let i = 0; while (s0.v[i] < half) i++;
  const te = src.series.t0 + i * src.series.dt, T = x => App.calib.tAt(c(), x), out = {};
  for (const order of ['refFirst', 'refSecond']) {
    d.parts[1].shift = 5e-9; App.docs.remerge(d, true);
    App.view.setWindow(d, App.calib.xAt(c(), te - 50e-9), App.calib.xAt(c(), te + 50e-9));
    const xr = App.calib.xAt(c(), te), xo = App.calib.xAt(c(), te + 5e-9);
    Object.assign(d.cursors, order === 'refFirst' ? { x1: xr, x2: xo } : { x1: xo, x2: xr });
    App.docs.touch(d);
    document.getElementById('btn-align-1').click();
    const r = { shift: d.parts[1].shift, t1: T(d.cursors.x1), t2: T(d.cursors.x2) };
    document.getElementById('btn-undo').click();
    Object.assign(r, { uShift: d.parts[1].shift, u1: T(d.cursors.x1), u2: T(d.cursors.x2), w1: T(order === 'refFirst' ? xr : xo), w2: T(order === 'refFirst' ? xo : xr) });
    out[order] = r;
  }
  await App.docs.remove(d.id); await App.docs.remove(copy.id); App.docs.setActive(keep.id);
  return { te, out };
})()
'@
  foreach ($o in 'refFirst', 'refSecond') {
    $r = $al.out.$o
    Check "Align, reference at cursor $(if ($o -eq 'refFirst') { 1 } else { 2 }): offset back to 0, cursors on the edge" (([math]::Abs($r.shift) -lt 1e-13) -and ([math]::Abs($r.t1 - $al.te) -lt 1e-12) -and ([math]::Abs($r.t2 - $al.te) -lt 1e-12)) ("shift={0} t1={1} t2={2} edge={3}" -f $r.shift, $r.t1, $r.t2, $al.te)
    Check "undo Align ($o) restores the offset and the cursors" (([math]::Abs($r.uShift - 5e-9) -lt 1e-15) -and ([math]::Abs($r.u1 - $r.w1) -lt 1e-12) -and ([math]::Abs($r.u2 - $r.w2) -lt 1e-12)) ("shift={0} t1={1} t2={2}" -f $r.uShift, $r.u1, $r.u2)
  }
  Wait-Cdp $sess 'App.docs.list().length === 3 && App.docs.active().parts' 10

  # Ctrl+drag the WFM05 curve 100 px to the right
  $g = Invoke-CdpJs $sess @'
(() => {
  const d = App.docs.active(), cv = document.getElementById('view'), r = cv.getBoundingClientRect();
  const s = d.series, col = s.cols.find(c => c.id === 'C3'), xa = (col.t0 - s.t0) / s.dt, xb = xa + (col.v.length - 1) * col.dt / s.dt;
  App.view.setWindow(d, xa, xb);   // show the whole WFM05 recording
  const v = { xa: d.view.xa, xb: d.view.xb }, W = cv.clientWidth, kx = (W - 54) / (v.xb - v.xa);
  const x = (v.xa + v.xb) / 2, val = App.series.valueAt(s, 'C3', x);
  const sx = r.left + 50 + (x - v.xa) * kx, sy = r.top + 34 + App.calib.yAt(d.calib, 'C3', val) * (cv.clientHeight - 74) / 800;
  return { sx, sy, spp: s.dt / kx, s0: d.parts[1].shift };
})()
'@
  Start-Sleep -Milliseconds 100
  Send-CdpMouse $sess 'mouseMoved' $g.sx $g.sy 'none' 1 2
  Send-CdpMouse $sess 'mousePressed' $g.sx $g.sy 'left' 1 2
  for ($k = 1; $k -le 5; $k++) { Send-CdpMouse $sess 'mouseMoved' ($g.sx + 20 * $k) $g.sy 'left' 1 2 }
  Send-CdpMouse $sess 'mouseReleased' ($g.sx + 100) $g.sy 'left' 1 2
  $cd = Invoke-CdpJs $sess 'App.docs.active().parts[1].shift'
  Check 'Ctrl+drag on a curve shifts its recording' ([math]::Abs(($cd - $g.s0) - 100 * $g.spp) -lt 2 * $g.spp) ("moved {0:E3} s, expected {1:E3} s" -f ($cd - $g.s0), (100 * $g.spp))
  if ($ShotDir) { Start-Sleep -Milliseconds 200; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_merge_shifted.png') }

  # dropping a screenshot is refused; reload restores the merged view
  Start-Sleep -Milliseconds 900
  Invoke-Cdp $sess 'Page.reload' @{} | Out-Null
  Start-Sleep -Milliseconds 500
  Wait-Cdp $sess 'window.App && App.docs && App.docs.list().length === 3 && App.docs.active()' 30
  $rl = Invoke-CdpJs $sess '(() => { const d = App.docs.active(); return { parts: d.parts && d.parts.length, shift: d.parts && d.parts[1].shift, n: d.series.cols.length, recs: document.querySelectorAll("#calib [data-shift]").length }; })()'
  Check 'reload restores the merged view with its shift' (($rl.parts -eq 2) -and ([math]::Abs($rl.shift - $cd) -lt 1e-15) -and ($rl.n -eq 3) -and ($rl.recs -eq 1)) ("parts={0} shift={1}" -f $rl.parts, $rl.shift)

  # export / import round trip (original files and lossless) keeps recordings and shift
  $rt = Invoke-CdpJs $sess @'
(async () => {
  const d = App.docs.active(), out = {};
  for (const mode of ['exact', 'lossless']) {
    const e = await App.docs.exportSession(mode), n0 = App.docs.list().length;
    await App.docs.importSession(new File([e.blob], mode + '.json'));
    const imp = App.docs.list().slice(n0).find(x => x.parts);
    let diff = 0;
    d.series.cols.forEach((c, j) => { const b = imp.series.cols[j]; for (let i = 0; i < c.v.length; i += 7) diff = Math.max(diff, Math.abs(c.v[i] - b.v[i])); if (b.t0 !== c.t0) diff = Infinity; });
    out[mode] = diff;
    for (const x of App.docs.list().slice(n0)) await App.docs.remove(x.id);
  }
  return out;
})()
'@
  Check 'merged view export round trip (original + lossless)' (($rt.exact -eq 0) -and ($rt.lossless -eq 0)) ("exact={0} lossless={1}" -f $rt.exact, $rt.lossless)

  # keyboard path: M opens the dialog for the active CSV
  Invoke-CdpJs $sess 'App.docs.setActive(App.docs.list()[0].id)' | Out-Null
  Send-CdpKey $sess 'm' 'KeyM' 77
  Start-Sleep -Milliseconds 100
  Check 'M opens the merge dialog' (Invoke-CdpJs $sess 'document.getElementById("merge-dlg").open')
  Send-CdpKey $sess 'Escape' 'Escape' 27
} finally { Stop-CdpSession $sess }

if ($fails) { Write-Host "FAILED: $fails check(s)"; exit 1 } else { Write-Host 'ALL UI CHECKS PASSED' }
