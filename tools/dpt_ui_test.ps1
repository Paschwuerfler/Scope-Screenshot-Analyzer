# DPT page UI test over CDP: adds samples/NOR45A24 twice through the real batch dialog (with
# different Rg), hovers / pins in the trend plot, switches edges, sorts the table, reloads
# and checks that the pool and the view settings were restored.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\dpt_ui_test.ps1 [-ShotDir <folder>]
param([string]$ShotDir = '')
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\cdp.ps1"

$fails = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host "  PASS  $name  $detail" } else { Write-Host "  FAIL  $name  $detail"; $script:fails++ }
}
function Shot($sess, [string]$name) { if ($ShotDir) { Start-Sleep -Milliseconds 250; Save-CdpScreenshot $sess (Join-Path $ShotDir $name) } }
function Set-Select($sess, [string]$id, [string]$value) {
  Invoke-CdpJs $sess "(() => { const s = document.getElementById('$id'); s.value = '$value'; s.dispatchEvent(new Event('change')); return true; })()" | Out-Null
}

# Reads the sample folder with XHR (allowed by --allow-file-access-from-files) and hands it to the
# same entry point a folder drop uses.
$addJs = @'
(async (folder) => {
  const names = []; for (let k = 1; k <= 21; k++) { const id = 'S' + String(k).padStart(2, '0'); names.push(id + '_C1.CSV', id + '_C3.CSV'); }
  const get = n => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', 'samples/NOR45A24/' + n);
    x.onload = () => res(new File([x.responseText], n, { type: 'text/csv' })); x.onerror = () => rej(new Error(n)); x.send(); });
  App.dpt.app.addFiles(await Promise.all(names.map(get)), folder);
  return true;
})
'@
# Set an input of the parameter table in the batch dialog and fire 'input' like typing would.
$setParamJs = @'
((row, field, value) => { const el = document.querySelectorAll('#bd-params tr[data-k]')[row].querySelector(`input[data-f="${field}"]`);
  el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })
'@
$paramsJs = 'JSON.stringify([...document.querySelectorAll("#bd-params tr[data-k] input")].map(i => i.value))'

$sess = Start-CdpSession 'dpt.html' -Width 1600 -Height 1000
try {
  Wait-Cdp $sess 'document.body.dataset.ready === "1"' 30
  Invoke-CdpJs $sess 'App.dpt.pool.clear().then(() => true)' | Out-Null
  Invoke-CdpJs $sess "($addJs)('NOR45A24_Rg10_24V')" | Out-Null
  Wait-Cdp $sess 'document.querySelector("#batch-dlg").open' 30
  $rows = Invoke-CdpJs $sess 'document.querySelectorAll("#bd-shots tbody tr").length'
  Check 'dialog lists 21 shots' ($rows -eq 21) "$rows"
  $p = Invoke-CdpJs $sess $paramsJs
  Check 'params guessed from folder name' ($p -eq '["Rg","10","V","24 V"]') $p
  Invoke-CdpJs $sess "($setParamJs)(1, 'key', 'Vdc')" | Out-Null
  Shot $sess 'dpt_dialog.png'
  Invoke-CdpJs $sess 'document.querySelector("[data-bd=ok]").click()' | Out-Null
  Wait-Cdp $sess 'App.dpt.pool.shots.length === 21 && !document.querySelector("#batch-dlg").open' 30
  Check 'batch added' $true
  $warn = Invoke-CdpJs $sess '[...document.querySelectorAll(".shot")].filter(e => e.querySelector(".badge.warn")).map(e => e.querySelector(".shot-label").textContent).join(",")'
  Check 'S01 flagged (no edge)' ($warn -eq 'S01') $warn
  $edges = Invoke-CdpJs $sess 'App.dpt.pool.edgeKeys().join(",")'
  Check 'edges rise1, fall1' ($edges -eq 'rise1,fall1') $edges
  $n = Invoke-CdpJs $sess 'App.dpt.ui.debug().trend.length'
  Check 'trend has 20 points' ($n -eq 20) "$n"
  Shot $sess 'dpt_main.png'

  # --- hover + click a trend point
  $pt = Invoke-CdpJs $sess '(() => { const p = App.dpt.ui.debug().trend[10], r = document.getElementById("cv-trend").getBoundingClientRect(); return [r.left + p.X, r.top + p.Y, p.id]; })()'
  Send-CdpMouse $sess 'mouseMoved' $pt[0] $pt[1]
  $h = Invoke-CdpJs $sess 'App.dpt.ui.debug().hover'
  Check 'hover trend point' ($h -eq $pt[2])
  $hlRow = Invoke-CdpJs $sess "!!document.querySelector('#tbl tr.hl[data-row=`"$($pt[2])`"]')"
  Check 'hover highlights table row' $hlRow
  Send-CdpMouse $sess 'mousePressed' $pt[0] $pt[1]; Send-CdpMouse $sess 'mouseReleased' $pt[0] $pt[1]
  $pin = Invoke-CdpJs $sess 'App.dpt.ui.debug().pinned.join(",")'
  Check 'click pins shot' ($pin -eq $pt[2])
  Shot $sess 'dpt_pinned.png'
  Send-CdpKey $sess 'Escape' 'Escape' 27
  Check 'Esc unpins' ((Invoke-CdpJs $sess 'App.dpt.ui.debug().pinned.length') -eq 0)

  # --- overlay zoom with the wheel, F fits again
  Invoke-Cdp $sess 'Input.dispatchMouseEvent' @{ type = 'mouseWheel'; x = 900; y = 220; deltaX = 0; deltaY = -120 } | Out-Null
  $v = Invoke-CdpJs $sess 'JSON.stringify(App.dpt.ui.prefs.view)'
  Check 'wheel zooms overlay' ($v -ne 'null') $v
  Send-CdpMouse $sess 'mouseMoved' 10 990
  Send-CdpKey $sess 'f' 'KeyF' 70
  Check 'F fits overlay' (Invoke-CdpJs $sess 'App.dpt.ui.prefs.view === null')

  # --- second folder, same shots with Rg = 22 -> two groups
  Invoke-CdpJs $sess "($addJs)('NOR45A24_Rg22_24V')" | Out-Null
  Wait-Cdp $sess 'document.querySelector("#batch-dlg").open' 30
  $p = Invoke-CdpJs $sess $paramsJs
  $w = Invoke-CdpJs $sess 'document.getElementById("bd-warn").hidden ? "" : document.getElementById("bd-warn").textContent'
  Check 'no import warning (same sample rate, no clipping)' ($w -eq '') $w
  Check 'params carried over + folder name' ($p -eq '["Rg","22","Vdc","24 V","V","24 V"]') $p
  Invoke-CdpJs $sess 'document.querySelectorAll("#bd-params [data-bd=del-param]")[2].click(); true' | Out-Null
  Invoke-CdpJs $sess 'document.querySelector("[data-bd=ok]").click()' | Out-Null
  Wait-Cdp $sess 'App.dpt.pool.shots.length === 42' 30
  $setGroupJs = @'
((i, v) => { const s = document.querySelector(`#sel-groups [data-gi="${i}"]`); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); document.activeElement.blur(); return true; })
'@
  while ((Invoke-CdpJs $sess 'App.dpt.ui.prefs.groups.length') -gt 0) { Invoke-CdpJs $sess "($setGroupJs)(0, '')" | Out-Null }
  Invoke-CdpJs $sess "($setGroupJs)(0, 'Rg')" | Out-Null
  $n = Invoke-CdpJs $sess 'App.dpt.ui.debug().trend.length'
  Check 'trend has 40 points' ($n -eq 40) "$n"
  $keys = Invoke-CdpJs $sess 'App.dpt.pool.paramKeys().map(k => k.key).join(",")'
  Check 'param keys' ($keys -eq 'I,Folder,Rg,Vdc') $keys
  Shot $sess 'dpt_two_groups.png'

  # --- group by two keys: Rg + Folder -> one line per pair, labels name both
  Invoke-CdpJs $sess "($setGroupJs)(1, 'Folder')" | Out-Null
  $g = Invoke-CdpJs $sess 'App.dpt.ui.debug().groups.map(c => c.split(String.fromCharCode(183)).map(s => s.trim()).join("+")).join("|")'
  Check 'group by Rg + Folder' ($g -eq 'Rg = 10+Folder = NOR45A24_Rg10_24V|Rg = 22+Folder = NOR45A24_Rg22_24V') $g
  $s = Invoke-CdpJs $sess '[...document.querySelectorAll("#sel-groups select")].map(s => s.value).join(",")'
  Check 'group selects Rg, Folder, + empty' ($s -eq 'Rg,Folder,') $s
  Invoke-CdpJs $sess "($setGroupJs)(1, '')" | Out-Null
  Check 'removing the second key' ((Invoke-CdpJs $sess 'App.dpt.ui.prefs.groups.join(",")') -eq 'Rg')

  # --- ringing frequency: Y metric and table column right after ringing pk-pk
  Set-Select $sess 'sel-metric' 'fRing'
  $rf = Invoke-CdpJs $sess 'JSON.stringify({ pts: App.dpt.ui.debug().trend.length, cols: [...document.querySelectorAll("#tbl th")].map(t => t.dataset.col).join(",") })' | ConvertFrom-Json
  Check 'ringing frequency plotted and listed before the levels' (($rf.pts -gt 0) -and ($rf.cols -match 'ringPP,fRing,swing,base,top')) "$($rf.pts) pts; $($rf.cols)"

  # --- falling edge, ringing metric, log X
  Send-CdpKey $sess 'e' 'KeyE' 69
  Check 'E switches to fall1' ((Invoke-CdpJs $sess 'App.dpt.ui.prefs.edge') -eq 'fall1')
  Set-Select $sess 'sel-metric' 'ringPP'
  Send-CdpKey $sess 'l' 'KeyL' 76
  Check 'L toggles log X' (Invoke-CdpJs $sess 'App.dpt.ui.prefs.logX')
  Shot $sess 'dpt_fall_ring_log.png'

  # --- table sort + CSV
  Invoke-CdpJs $sess 'document.querySelector("#tbl th[data-col=I]").click(); true' | Out-Null
  Invoke-CdpJs $sess 'document.querySelector("#tbl th[data-col=I]").click(); true' | Out-Null
  $first = Invoke-CdpJs $sess 'document.querySelector("#tbl tbody tr td:nth-child(2)").textContent'
  Check 'sort by I descending' ($first -eq 'S21') $first
  $csv = Invoke-CdpJs $sess 'App.dpt.ui.tableText(",").split("\n")'
  Check 'CSV has 40 rows + header' ($csv.Count -eq 41 -and $csv[0] -match '\[V/s\]') $csv[0]

  # --- filter: / focuses it, terms narrow table, trend and overlay; bad terms are flagged; Esc clears
  Send-CdpKey $sess '/' 'Slash' 191
  Check '/ focuses the filter' ((Invoke-CdpJs $sess 'document.activeElement.id') -eq 'flt')
  $setF = { param($t) Invoke-CdpJs $sess "(() => { const i = document.getElementById('flt'); i.value = '$t'; i.dispatchEvent(new Event('input')); return true; })()" | Out-Null; Start-Sleep -Milliseconds 400 }
  & $setF 'rg = 10'
  $f = Invoke-CdpJs $sess 'JSON.stringify({ rows: document.querySelectorAll("#tbl tbody tr").length, pts: App.dpt.ui.debug().trend.length, struck: document.querySelectorAll(".shot.filtered").length, title: document.getElementById("tbl-title").textContent })' | ConvertFrom-Json
  Check 'Rg=10 filters table, trend and pool list' ($f.rows -eq 20 -and $f.pts -eq 20 -and $f.struck -eq 20 -and $f.title -match '20 of 40') ($f | ConvertTo-Json -Compress)
  $mid = Invoke-CdpJs $sess '(() => { const v = App.dpt.pool.rows("fall1").map(r => r.p.I).sort((a, b) => a - b); return v[20]; })()'
  & $setF "Rg=10  I ~ $($mid) A"
  $n = Invoke-CdpJs $sess "App.dpt.pool.rows('fall1').filter(r => r.edge && Math.abs(r.p.I - $mid) <= 0.1 * $mid && r.batch.params.some(p => p.key === 'Rg' && p.value === 10)).length"
  $got = Invoke-CdpJs $sess 'document.querySelectorAll("#tbl tbody tr").length'
  Check 'I~x combines with Rg=10' ($got -eq $n -and $n -gt 0) "$got rows, $n expected (I~$($mid)A)"
  Shot $sess 'dpt_filter.png'
  & $setF 'Rg=10 I>>5'
  Check 'unreadable term marked invalid' (Invoke-CdpJs $sess 'document.getElementById("flt").classList.contains("invalid")')
  Invoke-CdpJs $sess 'document.getElementById("flt").focus(); true' | Out-Null
  Send-CdpKey $sess 'Escape' 'Escape' 27
  Check 'Esc clears the filter' ((Invoke-CdpJs $sess 'App.dpt.ui.prefs.filter') -eq '' -and (Invoke-CdpJs $sess 'App.dpt.ui.debug().trend.length') -eq 40)
  Invoke-CdpJs $sess 'document.activeElement.blur(); true' | Out-Null

  # --- right-click a table row -> context menu -> open the shot in the analyzer tab
  $row = Invoke-CdpJs $sess '(() => { const tr = document.querySelectorAll("#tbl tbody tr")[2], r = tr.getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2, tr.dataset.row, tr.children[1].textContent]; })()'
  Invoke-Cdp $sess 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $row[0]; y = $row[1]; button = 'right'; buttons = 2; clickCount = 1 } | Out-Null
  Invoke-Cdp $sess 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $row[0]; y = $row[1]; button = 'right'; buttons = 0; clickCount = 1 } | Out-Null
  $menu = Invoke-CdpJs $sess '(() => { const m = document.getElementById("ctx-menu"); return m.style.display + "|" + m.dataset.shot; })()'
  Check 'right-click opens context menu' ($menu -eq "block|$($row[2])") $menu
  Check 'right-click does not pin' ((Invoke-CdpJs $sess 'App.dpt.ui.debug().pinned.length') -eq 0)
  Shot $sess 'dpt_ctx_menu.png'
  $btn = Invoke-CdpJs $sess '(() => { const r = document.querySelector("[data-ctx=open]").getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })()'
  Send-CdpMouse $sess 'mousePressed' $btn[0] $btn[1]; Send-CdpMouse $sess 'mouseReleased' $btn[0] $btn[1]
  Check 'menu closes' ((Invoke-CdpJs $sess 'document.getElementById("ctx-menu").style.display') -eq 'none')
  $scope = Connect-CdpTarget $sess '*index.html*'
  try {
    Wait-Cdp $scope "window.App && App.docs.active() && App.docs.active().name.startsWith('$($row[3]) \u00b7 ')" 30
    $lbl = Invoke-CdpJs $sess "JSON.stringify(App.dpt.app.scopeLabel(App.dpt.pool.shots.find(s => s.id === '$($row[2])')))" | ConvertFrom-Json
    $sn = Invoke-CdpJs $scope 'JSON.stringify({ name: App.docs.active().name, notes: document.getElementById("doc-notes").value })' | ConvertFrom-Json
    Check 'name = values only (shot, Rg, Vdc, I)' ($sn.name -match "^$($row[3]) \u00b7 (10|22) \u00b7 24 V \u00b7 [\d.]+ A \(NOR45A24_Rg(10|22)_24V\)$") $sn.name
    Check 'notes list parameters and I' (($sn.notes -eq $lbl.notes) -and ($sn.notes -match 'Rg = (10|22)') -and ($sn.notes -match 'Vdc = 24 V') -and ($sn.notes -match 'I = [\d.]+ A')) ($sn.notes -replace "`n", ' | ')
    $d = Invoke-CdpJs $scope '(() => { const d = App.docs.active(), s = d.series, t = x => s.t0 + x * s.dt; return JSON.stringify({ ch: s.cols.map(c => c.id + c.unit).join(","), n: App.docs.list().length, c1: t(d.cursors.x1), c2: t(d.cursors.x2), a: t(d.view.xa), b: t(d.view.xb) }); })()'
    $o = $d | ConvertFrom-Json
    Check 'shot opened in analyzer (C1 V + C3 A)' ($o.ch -eq 'C1V,C3A' -and $o.n -eq 1) $d
    Check 'zoomed to the edge, cursors inside' ($o.a -lt $o.c1 -and $o.c1 -lt $o.c2 -and $o.c2 -lt $o.b -and ($o.b - $o.a) -lt 1e-6) $d
    if ($ShotDir) { Start-Sleep -Milliseconds 400; Save-CdpScreenshot $scope (Join-Path $ShotDir 'dpt_opened_in_scope.png') }
    # O key on the same (hovered) row again: reuses the doc instead of adding a second one
    Send-CdpMouse $sess 'mouseMoved' $row[0] $row[1]
    Send-CdpKey $sess 'o' 'KeyO' 79
    Start-Sleep -Milliseconds 800
    Check 'O reuses the open shot' ((Invoke-CdpJs $scope 'App.docs.list().length') -eq 1)
  } finally { $scope.Ws.Dispose() }

  # --- repeats: give folder 2 the parameters of folder 1, so every shot pair merges into one point
  $n0 = Invoke-CdpJs $sess 'App.dpt.ui.debug().trend.length'
  Invoke-CdpJs $sess '(() => { const [a, b] = App.dpt.pool.batches; window.__p = b.params; return App.dpt.pool.updateBatch(b.id, { params: a.params.map(q => Object.assign({}, q)) }).then(() => true); })()' | Out-Null
  Set-Select $sess 'sel-repeats' 'range'
  $n1 = Invoke-CdpJs $sess 'App.dpt.ui.debug().trend.length'
  Check 'repeats merge into one point per shot' ($n1 * 2 -eq $n0) "$n0 -> $n1"
  Shot $sess 'dpt_repeats.png'
  Set-Select $sess 'sel-repeats' 'off'
  Check 'Repeats: each shot shows all points' ((Invoke-CdpJs $sess 'App.dpt.ui.debug().trend.length') -eq $n0)
  Set-Select $sess 'sel-repeats' 'sd'
  Invoke-CdpJs $sess '(() => { const b = App.dpt.pool.batches[1]; return App.dpt.pool.updateBatch(b.id, { params: window.__p }).then(() => true); })()' | Out-Null

  # --- new parameter in folder 2 -> asked for the value of folder 1, Enter fills it in
  Invoke-CdpJs $sess 'App.dpt.ui.openBatchDialog({ batchId: App.dpt.pool.batches[1].id }); true' | Out-Null
  Wait-Cdp $sess 'document.querySelector("#batch-dlg").open' 10
  Invoke-CdpJs $sess 'document.querySelector("[data-bd=add-param]").click(); true' | Out-Null
  $last = Invoke-CdpJs $sess 'document.querySelectorAll("#bd-params tr[data-k]").length - 1'
  Invoke-CdpJs $sess "($setParamJs)($last, 'key', 'SC')" | Out-Null
  Invoke-CdpJs $sess "($setParamJs)($last, 'text', '1')" | Out-Null
  Invoke-CdpJs $sess 'document.querySelector("[data-bd=ok]").click()' | Out-Null
  Wait-Cdp $sess 'document.querySelector("#newparam-dlg").open' 10
  Check 'new parameter asks for a default' ((Invoke-CdpJs $sess 'document.querySelector("#np-params td").textContent') -eq 'SC')
  Shot $sess 'dpt_new_param.png'
  Invoke-CdpJs $sess '(() => { const i = document.querySelector("#np-params input"); i.value = "3"; return true; })()' | Out-Null
  Send-CdpKey $sess 'Enter' 'Enter' 13
  Wait-Cdp $sess '!document.querySelector("#newparam-dlg").open && !document.querySelector("#batch-dlg").open' 10
  $sc = Invoke-CdpJs $sess 'App.dpt.pool.batches.map(b => (b.params.find(p => p.key === "SC") || {}).value).join(",")'
  Check 'default filled into the earlier folder' ($sc -eq '3,1') $sc

  # --- hide a folder, reload, everything restored
  Invoke-CdpJs $sess 'document.querySelectorAll(".batch summary input")[1].click(); true' | Out-Null
  Wait-Cdp $sess 'App.dpt.ui.debug().trend.length === 20' 10
  Check 'hiding a folder removes its points' $true
  Invoke-Cdp $sess 'Page.reload' @{} | Out-Null
  Start-Sleep -Milliseconds 500
  Wait-Cdp $sess 'document.body.dataset.ready === "1" && App.dpt.pool.shots.length === 42' 30
  $st = Invoke-CdpJs $sess 'JSON.stringify({ edge: App.dpt.ui.prefs.edge, metric: App.dpt.ui.prefs.metric, group: App.dpt.ui.prefs.groups.join(), pts: App.dpt.ui.debug().trend.length, hidden: App.dpt.pool.shots.filter(s => s.hidden).length })'
  Check 'reload restores pool and view' ($st -eq '{"edge":"fall1","metric":"ringPP","group":"Rg","pts":20,"hidden":21}') $st
  Shot $sess 'dpt_reloaded.png'
} finally { Stop-CdpSession $sess }

if ($fails) { Write-Host "FAILED $fails check(s)"; exit 1 } else { Write-Host 'ALL PASSED' }
