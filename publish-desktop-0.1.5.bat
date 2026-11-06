@echo off
setlocal
title Publish VPOS Desktop 0.1.5

set "VPOS_EXTRA_ARGS="
if /I "%~1"=="validate" set "VPOS_EXTRA_ARGS=-ValidateOnly"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-desktop-update.ps1" -Version "0.1.5" -Notes "Transfer, pricing, sync, cashier identity, and stability improvements." %VPOS_EXTRA_ARGS%
set "VPOS_EXIT_CODE=%ERRORLEVEL%"

echo.
if "%VPOS_EXIT_CODE%"=="0" (
  echo VPOS Desktop 0.1.5 publish workflow completed successfully.
) else (
  echo VPOS Desktop 0.1.5 publish workflow failed with exit code %VPOS_EXIT_CODE%.
)
pause
exit /b %VPOS_EXIT_CODE%
