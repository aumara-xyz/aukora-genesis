@echo off
rem LUMINARA — the architect's own door. Tier A of THE LOCAL PROGRAMME.
rem
rem Double-click this file. The portal opens in its own window with no
rem browser chrome, and this console window IS the door: closing it closes
rem the door and leaves nothing running. No installer, no startup entry, no
rem background process, no notification, ever.
rem
rem The door is read-only by construction (GET and HEAD, no write lane), and
rem everything the vessel keeps stays in this machine's own browser store.
rem The window shares the system's ordinary Edge profile on purpose, so the
rem casts on the shelf are the same casts whether the portal is opened from
rem here or from a browser tab at the same address.
rem
rem Requires Bun on the machine and nothing else.
rem
rem   luminara.cmd          opens on port 7097
rem   luminara.cmd 7099     opens on a port of your choosing

setlocal
cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=7097"

where bun >nul 2>&1
if errorlevel 1 (
  echo Luminara needs Bun on this machine and cannot find it.
  echo Install it from https://bun.sh, then run this file again.
  echo.
  pause
  exit /b 1
)

rem the window: the system's Edge in app mode, so the portal wears no chrome.
rem The door answers / with the Wayfinder, so the address stays the plain root.
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE%" (
  start "" "%EDGE%" --app=http://127.0.0.1:%PORT%/
) else (
  rem no Edge on this machine: the default browser opens it as an ordinary page
  start "" http://127.0.0.1:%PORT%/
)

echo.
echo   LUMINARA is open at http://127.0.0.1:%PORT%
echo   This window is the door. Close it to close the portal.
echo.

rem the door runs here, in the foreground: one process, one window, one
rem shutdown, and no orphan left listening once this window is gone
bun spatial/serve.ts %PORT%

endlocal
