# Runs tools/test.html in headless Edge/Chrome and prints the results.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\run_tests.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\headless.ps1"
$out = Invoke-HeadlessPage (Join-Path $PSScriptRoot 'test.html') 'out'
$text = [regex]::Replace($out, '<[^>]+>', '')
Write-Host $text
if ($text -notmatch '^ALL PASSED') { exit 1 }
