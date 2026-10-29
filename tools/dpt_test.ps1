# Runs tools/dpt_test.html (DPT edge metrics, parameter parsing, samples/NOR45A24) in headless
# Edge/Chrome over CDP and prints the results.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\dpt_test.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\cdp.ps1"
$s = Start-CdpSession 'tools/dpt_test.html'
try {
  Wait-Cdp $s 'document.getElementById("out").textContent !== "PENDING"' 60
  $text = Invoke-CdpJs $s 'document.getElementById("out").textContent'
} finally { Stop-CdpSession $s }
Write-Host $text
if ($text -notmatch '^ALL PASSED') { exit 1 }
