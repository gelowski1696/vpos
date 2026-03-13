@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
set "DIST_DIR=%ROOT%\dist\transfer"
set "STAGE_DIR=%TEMP%\vpos-transfer-stage"
set "ZIP_PATH=%DIST_DIR%\vpos-transfer.zip"

echo [VPOS][PACK] Preparing transfer package...

if exist "%STAGE_DIR%" powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '%STAGE_DIR%' -Recurse -Force -ErrorAction SilentlyContinue"
if exist "%ZIP_PATH%" del /f /q "%ZIP_PATH%"
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
mkdir "%STAGE_DIR%" >nul 2>nul

call :copy_file "package.json"
call :copy_file "pnpm-lock.yaml"
call :copy_file "pnpm-workspace.yaml"
call :copy_file ".dockerignore"

call :copy_dir "apps\api"
call :copy_dir "apps\web"
call :copy_dir "packages\shared-types"
call :copy_dir "packages\ai-ready"
call :copy_dir "infra"
call :copy_dir "scripts"
call :copy_dir "docs"

if errorlevel 1 goto :fail

echo [VPOS][PACK] Creating ZIP: %ZIP_PATH%
for /f %%C in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ChildItem -LiteralPath '%STAGE_DIR%' -Recurse -File | Measure-Object).Count"') do set "FILE_COUNT=%%C"
if "%FILE_COUNT%"=="" set "FILE_COUNT=0"
if "%FILE_COUNT%"=="0" (
  echo [VPOS][PACK] ERROR stage folder has no files.
  goto :fail
)
echo [VPOS][PACK] Staged files: %FILE_COUNT%

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE_DIR%\*' -DestinationPath '%ZIP_PATH%' -Force"
if errorlevel 1 goto :zip_fail

echo [VPOS][PACK] Done.
echo [VPOS][PACK] Output: %ZIP_PATH%
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item -LiteralPath '%STAGE_DIR%' -Recurse -Force -ErrorAction SilentlyContinue"
exit /b 0

:copy_file
set "REL=%~1"
if not exist "%ROOT%\%REL%" (
  echo [VPOS][PACK] WARN missing file: %REL%
  exit /b 0
)
for %%I in ("%STAGE_DIR%\%REL%") do mkdir "%%~dpI" >nul 2>nul
copy /Y "%ROOT%\%REL%" "%STAGE_DIR%\%REL%" >nul
if errorlevel 1 (
  echo [VPOS][PACK] ERROR copy failed: %REL%
  exit /b 1
)
exit /b 0

:copy_dir
set "REL=%~1"
if not exist "%ROOT%\%REL%" (
  echo [VPOS][PACK] WARN missing dir: %REL%
  exit /b 0
)
echo [VPOS][PACK] Copying %REL% ...
robocopy "%ROOT%\%REL%" "%STAGE_DIR%\%REL%" /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP ^
  /XJ /SL ^
  /XD "node_modules" ".git" ".next" "dist" "build" ".turbo" ".expo" ".gradle" "android\app\build" "android\.gradle" ^
  /XF ".env"
if errorlevel 8 (
  echo [VPOS][PACK] ERROR copy failed: %REL%
  exit /b 1
)
exit /b 0

:zip_fail
echo [VPOS][PACK] ZIP creation failed.
exit /b 1

:fail
echo [VPOS][PACK] Packaging failed.
exit /b 1
