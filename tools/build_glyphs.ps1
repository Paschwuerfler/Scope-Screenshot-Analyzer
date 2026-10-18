# Regenerates js/ocr_glyphs.js from the sample screenshots (see tools/harvest.html).
# Usage (from anywhere):  powershell -ExecutionPolicy Bypass -File tools\build_glyphs.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\headless.ps1"
$out = Invoke-HeadlessPage (Join-Path $PSScriptRoot 'harvest.html') 'out'
if ($out -notmatch '^// GENERATED') { Write-Host (Invoke-HeadlessPage (Join-Path $PSScriptRoot 'harvest.html') 'log'); throw "Harvest failed: $out" }
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'js\ocr_glyphs.js'
[System.IO.File]::WriteAllText($target, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host (Invoke-HeadlessPage (Join-Path $PSScriptRoot 'harvest.html') 'log')
Write-Host "Wrote $target"
