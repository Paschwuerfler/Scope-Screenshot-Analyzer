# Helper: render a local HTML page in headless Edge/Chrome and return the text of one element.
# Pages signal completion by replacing the element's "PENDING" text.
function Find-Browser {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  throw 'No Edge/Chrome found.'
}

function Invoke-HeadlessPage([string]$page, [string]$elementId) {
  $ErrorActionPreference = 'Continue'   # the browser logs harmless noise to stderr
  $browser = Find-Browser
  $userDir = Join-Path $env:TEMP 'scope-analyzer-headless'
  $url = 'file:///' + ((Resolve-Path $page).Path -replace '\\', '/')
  $html = & $browser --headless=new --disable-gpu --allow-file-access-from-files "--user-data-dir=$userDir" --virtual-time-budget=60000 --dump-dom $url 2>$null | Out-String
  $m = [regex]::Match($html, "<pre id=`"$elementId`"[^>]*>([\s\S]*?)</pre>")
  if (-not $m.Success) { throw "Element #$elementId not found in output" }
  return [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
}
