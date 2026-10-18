# Minimal Chrome DevTools Protocol driver for UI checks (no dependencies besides Edge/Chrome).
#
# Usage:
#   . tools\cdp.ps1
#   $s = Start-CdpSession 'index.html?samples=1' -Width 1600 -Height 950
#   Wait-Cdp $s 'document.body.dataset.demoReady === "1"'
#   Invoke-Cdp $s 'Input.dispatchMouseEvent' @{ type='mousePressed'; x=500; y=300; button='left'; clickCount=1 }
#   Invoke-CdpJs $s 'App.docs.list().length'
#   Save-CdpScreenshot $s 'out.png'
#   Stop-CdpSession $s
. "$PSScriptRoot\headless.ps1"

function Start-CdpSession([string]$page, [int]$Width = 1600, [int]$Height = 950, [int]$Port = 0) {
  if (-not $Port) {   # pick a free port so consecutive sessions don't collide
    $l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $Port = $l.LocalEndpoint.Port; $l.Stop()
  }
  $browser = Find-Browser
  $root = Split-Path $PSScriptRoot -Parent
  $path, $query = $page -split '\?', 2
  $url = 'file:///' + ((Resolve-Path (Join-Path $root $path)).Path -replace '\\', '/') + $(if ($query) { "?$query" } else { '' })
  $profile = Join-Path $env:TEMP ("scope-cdp-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $proc = Start-Process $browser -PassThru -ArgumentList @('--headless=new', '--disable-gpu', '--allow-file-access-from-files',
    "--remote-debugging-port=$Port", "--user-data-dir=$profile", "--window-size=$Width,$Height", '--hide-scrollbars', 'about:blank')
  $targets = $null
  for ($i = 0; $i -lt 50 -and -not $targets; $i++) {
    Start-Sleep -Milliseconds 200
    try { $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" } catch {}
  }
  $t = @($targets | Where-Object { $_.type -eq 'page' })[0]
  if (-not $t) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; throw "Browser did not expose a debuggable page on port $Port" }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(30)
  $ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $s = [pscustomobject]@{ Ws = $ws; Proc = $proc; Id = 0; Profile = $profile }
  Invoke-Cdp $s 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = $Height; deviceScaleFactor = 1; mobile = $false } | Out-Null
  Invoke-Cdp $s 'Page.navigate' @{ url = $url } | Out-Null
  return $s
}

function Invoke-Cdp($s, [string]$method, $params = @{}) {
  if ($s.Ws.State -ne 'Open') { throw "CDP socket not open ($($s.Ws.State))" }
  $s.Id++
  $msg = @{ id = $s.Id; method = $method; params = $params } | ConvertTo-Json -Depth 10 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
  $s.Ws.SendAsync([ArraySegment[byte]]::new($bytes), 'Text', $true, [Threading.CancellationToken]::None).Wait()
  $buf = New-Object byte[] 1048576
  while ($true) {
    $ms = New-Object IO.MemoryStream
    do {
      if ($s.Ws.State -ne 'Open') { throw "CDP socket closed while waiting for $method" }
      $r = $s.Ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [Threading.CancellationToken]::None).Result
      $ms.Write($buf, 0, $r.Count)
    } while (-not $r.EndOfMessage)
    $json = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
    if ($json.id -eq $s.Id) {
      if ($json.error) { throw "CDP $method failed: $($json.error.message)" }
      return $json.result
    }
  }
}

function Invoke-CdpJs($s, [string]$expr) {
  $r = Invoke-Cdp $s 'Runtime.evaluate' @{ expression = $expr; awaitPromise = $true; returnByValue = $true }
  if ($r.exceptionDetails) { throw "JS error: $($r.exceptionDetails.exception.description)" }
  return $r.result.value
}

function Wait-Cdp($s, [string]$condition, [int]$TimeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { if (Invoke-CdpJs $s "!!($condition)") { return } } catch {}
    Start-Sleep -Milliseconds 200
  }
  throw "Timeout waiting for: $condition"
}

function Save-CdpScreenshot($s, [string]$file) {
  $r = Invoke-Cdp $s 'Page.captureScreenshot' @{ format = 'png' }
  [IO.File]::WriteAllBytes($file, [Convert]::FromBase64String($r.data))
}

function Send-CdpMouse($s, [string]$type, [double]$x, [double]$y, [string]$button = 'left', [int]$clicks = 1) {
  Invoke-Cdp $s 'Input.dispatchMouseEvent' @{ type = $type; x = $x; y = $y; button = $button; clickCount = $clicks; buttons = $(if ($type -eq 'mouseReleased') { 0 } else { 1 }) } | Out-Null
}

function Send-CdpKey($s, [string]$key, [string]$code, [int]$keyCode, [int]$modifiers = 0) {
  Invoke-Cdp $s 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = $key; code = $code; windowsVirtualKeyCode = $keyCode; modifiers = $modifiers } | Out-Null
  Invoke-Cdp $s 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = $key; code = $code; windowsVirtualKeyCode = $keyCode; modifiers = $modifiers } | Out-Null
}

function Stop-CdpSession($s) {
  try { $s.Ws.Dispose() } catch {}
  try { Stop-Process -Id $s.Proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$($s.Profile)*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $s.Profile -ErrorAction SilentlyContinue
}
