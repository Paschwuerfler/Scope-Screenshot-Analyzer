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

if ($fails) { Write-Host "FAILED: $fails check(s)"; exit 1 } else { Write-Host 'ALL UI CHECKS PASSED' }
