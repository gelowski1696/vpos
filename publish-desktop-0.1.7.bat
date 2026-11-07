@echo off
setlocal
title Publish VPOS Desktop 0.1.7

set "VPOS_EXTRA_ARGS="
if /I "%~1"=="validate" set "VPOS_EXTRA_ARGS=-ValidateOnly"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-desktop-update.ps1" -Version "0.1.7" -Notes "Expense validation, resilient sync, transfer stock checks, and sync summaries." %VPOS_EXTRA_ARGS%
set "VPOS_EXIT_CODE=%ERRORLEVEL%"

echo.
if "%VPOS_EXIT_CODE%"=="0" (
  echo VPOS Desktop 0.1.7 publish workflow completed successfully.
) else (
  echo VPOS Desktop 0.1.7 publish workflow failed with exit code %VPOS_EXIT_CODE%.
)
pause
exit /b %VPOS_EXIT_CODE%
