# Testing and checking changes

All scripts run from the project root in Windows PowerShell 5.1 and need only Edge or Chrome.
They start a headless browser over the Chrome DevTools Protocol (`tools/cdp.ps1`, free port,
profile in `%TEMP%`) and close it afterwards.

| Command | Checks | Pass line |
|---|---|---|
| `powershell -ExecutionPolicy Bypass -File tools\run_tests.ps1` | detection / calibration / traces on all `samples/*.png` against `tools/samples.js` | `ALL PASSED: 53/53 checks` |
| `powershell -ExecutionPolicy Bypass -File tools\ui_test.ps1 -ShotDir <folder>` | analyzer UI: drag, nudge, double-click, navigate, merge, reload/restore; writes screenshots to `<folder>` (look at them) | `ALL UI CHECKS PASSED` |
| `powershell -ExecutionPolicy Bypass -File tools\dpt_test.ps1` | DPT edge metrics on synthetic pulses, clipping, import warnings, parameter parsing, `samples/NOR45A24` | `ALL PASSED (41 checks)` |
| `powershell -ExecutionPolicy Bypass -File tools\dpt_ui_test.ps1 -ShotDir <folder>` | DPT page: two folders through the dialog, hover / pin, edges, sort, open in analyzer, reload | `ALL PASSED` |
| `powershell -ExecutionPolicy Bypass -File tools\build_glyphs.ps1` | regenerates `js/ocr_glyphs.js` after OCR or sample changes | – |
| `powershell -ExecutionPolicy Bypass -File tools\build_demo.ps1` | regenerates `js/demo_image.js` | – |

Extend `ui_test.ps1` / `dpt_ui_test.ps1` when you change interactions.

## Ad-hoc checks
- `tools\cdp.ps1`: `Start-CdpSession 'dpt.html'`, `Wait-Cdp`, `Invoke-CdpJs` (awaits promises),
  `Send-CdpMouse`, `Send-CdpKey`, `Save-CdpScreenshot`, `Connect-CdpTarget` (other tab), `Stop-CdpSession`.
- `index.html?samples=N` replaces the session with the samples and selects image N; `index.html?demo`
  loads the built-in demo screenshot.
- Playwright MCP (`.mcp.json`): interactive browsing of `file:///<project root>/index.html` or `dpt.html`.
  Needs Node (tested 22.19); the first start downloads the pinned package with npx.
- Pages can read files next to them with XHR under `--allow-file-access-from-files` (the CDP helper
  sets it); `dpt_ui_test.ps1` loads `samples/NOR45A24` that way.

## Performance baseline (DPT page)
`samples/dpt-pool-2026-10-30.json` is a realistic large pool (13 folders, 273 shots, 35 MB). Load it in
a CDP session with XHR + `App.dpt.pool.importJson(text)` and time with `performance.now()`. Measured
2026-10-30, headless Edge: import 1.2 s (one render), restore on load 0.95 s (mostly CSV parsing),
full `renderAll` ~110 ms (mostly layout of the edge table), hover 7–10 ms, Y-metric change ~7 ms.
For CPU profiles use CDP `Profiler.start/stop`; time spent waiting for layout shows up under
`getBoundingClientRect` (the plots call it after the table was rebuilt). Time each event separately:
dozens of synchronous redraws in one loop give inflated numbers that real use never sees.

## Gotchas
- Headless `--dump-dom` with `--virtual-time-budget` is unreliable for the async app; use the CDP scripts.
- A browser profile inside a sandboxed scratch dir may have broken IndexedDB, hence `%TEMP%`.
- PowerShell variables are case-insensitive (`$S` = `$s`), and `$profile` is the built-in `$PROFILE`.
