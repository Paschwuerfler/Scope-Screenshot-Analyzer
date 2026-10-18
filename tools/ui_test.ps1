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
  if ($ShotDir) { Start-Sleep -Milliseconds 300; Save-CdpScreenshot $sess (Join-Path $ShotDir 'ui_restored.png') }
} finally { Stop-CdpSession $sess }

if ($fails) { Write-Host "FAILED: $fails check(s)"; exit 1 } else { Write-Host 'ALL UI CHECKS PASSED' }
