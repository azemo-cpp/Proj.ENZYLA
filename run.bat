@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%" || exit /b 1

set "TIFF=%ROOT%data\LRO_WAC_Mosaic_Global_303ppd.tif"
set "PART=%TIFF%.part"
set "TIFF_URL=https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LROC-WAC_Mosaic_global_100m_June2013.tif"
set "TIFF_BYTES=5959263751"
set "PREVIOUS_TIFF_BYTES=5959263407"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "%ROOT%node_modules\.bin\vite.cmd" (
  echo Dependencies are missing. Run "npm install" in this folder first.
  pause
  exit /b 1
)

where curl.exe >nul 2>nul
if errorlevel 1 (
  echo curl.exe is required to download the Moon TIFF.
  pause
  exit /b 1
)

if not exist "%ROOT%data\" mkdir "%ROOT%data"

set "CURRENT_BYTES="
if exist "%TIFF%" for %%F in ("%TIFF%") do set "CURRENT_BYTES=%%~zF"
if "%CURRENT_BYTES%"=="%TIFF_BYTES%" echo Found complete WAC mosaic; skipping download.
if "%CURRENT_BYTES%"=="%PREVIOUS_TIFF_BYTES%" echo Found complete WAC mosaic; skipping download.
if "%CURRENT_BYTES%"=="%TIFF_BYTES%" goto :start_app
if "%CURRENT_BYTES%"=="%PREVIOUS_TIFF_BYTES%" goto :start_app

set "PART_BYTES="
if exist "%PART%" for %%F in ("%PART%") do set "PART_BYTES=%%~zF"
if "%PART_BYTES%"=="%TIFF_BYTES%" goto :install_tiff

echo Downloading the USGS WAC mosaic (about 5.7 GiB). Interrupted downloads can be resumed by running this file again.
curl.exe --fail --location --retry 5 --retry-delay 3 --continue-at - --output "%PART%" "%TIFF_URL%"
if errorlevel 1 (
  echo Download failed. The partial file was kept so the next run can resume it.
  pause
  exit /b 1
)

set "PART_BYTES="
if exist "%PART%" for %%F in ("%PART%") do set "PART_BYTES=%%~zF"
if not "%PART_BYTES%"=="%TIFF_BYTES%" (
  echo Download size check failed. Expected %TIFF_BYTES% bytes; received %PART_BYTES% bytes.
  echo The partial file was kept so the next run can resume it.
  pause
  exit /b 1
)

:install_tiff
move /Y "%PART%" "%TIFF%" >nul
if errorlevel 1 (
  echo Could not move the verified download into the data folder.
  pause
  exit /b 1
)
echo WAC mosaic download verified.

:start_app
start "Daryl API" /D "%ROOT%" node "daryl\server.js"
start "Vite dev server" /D "%ROOT%" "%ROOT%node_modules\.bin\vite.cmd" --host 127.0.0.1 --strictPort

echo Starting the app at http://127.0.0.1:5173/
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173/"
