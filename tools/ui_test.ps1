# UI smoke test: drives the real app in headless Edge/Chrome via CDP.
# Loads the samples (?samples), drags a cursor, nudges with the keyboard, double-clicks,
# switches images, reloads the page and checks that everything was restored.
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
  Check 'display: scale change keeps centre value' (($c1[0] -eq 20) -and ([math]::Abs($c1[1] - $c0) -lt 1e-9)) "vdiv=$($c1[0]) centre $c0 -> $($c1[1])"

  # reload restores series docs
  Start-Sleep -Milliseconds 900
  Invoke-Cdp $sess 'Page.reload' @{} | Out-Null
  Start-Sleep -Milliseconds 500
  Wait-Cdp $sess 'window.App && App.docs && App.docs.list().length === 3 && App.docs.active()' 30
  $rs = Invoke-CdpJs $sess '(() => { const d = App.docs.active(); return { kind: d.kind, n: d.series && d.series.n, vdiv: d.calib.channels.C2.vdiv, series: document.body.classList.contains("series") }; })()'
  Check 'reload restores CSV doc' (($rs.kind -eq 'series') -and ($rs.n -eq 129304) -and ($rs.vdiv -eq 20) -and $rs.series) "kind=$($rs.kind) n=$($rs.n) vdiv=$($rs.vdiv)"
  $pw2 = Invoke-CdpJs $sess 'document.querySelector(".panel").getBoundingClientRect().width'
  Check 'reload keeps panel width' ([math]::Abs($pw2 - $pw) -lt 2) ("{0:N0} px" -f $pw2)
  if ($ShotDir) { Start-Sleep -Milliseconds 300; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_csv_restored.png') }
} finally { Stop-CdpSession $sess }

if ($fails) { Write-Host "FAILED: $fails check(s)"; exit 1 } else { Write-Host 'ALL UI CHECKS PASSED' }
