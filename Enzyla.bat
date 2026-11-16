@echo off
title Enzyla
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%" || goto :failed

if "%~1"=="" goto :setup_runtime
if /i "%~1"=="--help" goto :help
if /i "%~1"=="--generate-moon-lroc" goto :validate_source
if /i "%~1"=="--generate-moon-textures" goto :validate_source
goto :help

:validate_source
if /i "%~1"=="--generate-moon-lroc" if not exist "%ROOT%data\lroc_color_poles_8k.tif" goto :missing_lroc
if /i "%~1"=="--generate-moon-textures" if not exist "%ROOT%data\LRO_WAC_Mosaic_Global_303ppd.tif" goto :missing_wac

:setup_runtime
set "RUNTIME=%ROOT%.runtime\node"
set "NODE=%RUNTIME%\node.exe"
set "NPM=%RUNTIME%\npm.cmd"
set "ENZYLA_ROOT=%ROOT%"

if not exist "%NODE%" (
  echo Setting up Enzyla's private Node.js runtime...
  if not exist "%ROOT%.runtime" mkdir "%ROOT%.runtime"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $root=$env:ENZYLA_ROOT; $releases=Invoke-RestMethod 'https://nodejs.org/dist/index.json'; $release=$releases | Where-Object { $_.version.StartsWith('v22.') -and $_.files -contains 'win-x64-zip' } | Select-Object -First 1; $version=$release.version; if (-not $version) { throw 'Could not find a compatible Node.js 22 release.' }; $downloads=Join-Path $root '.runtime\downloads'; $stage=Join-Path $root '.runtime\extract'; $destination=Join-Path $root '.runtime\node'; New-Item -ItemType Directory -Force -Path $downloads,$stage,$destination | Out-Null; $archive=Join-Path $downloads ('node-' + $version + '-win-x64.zip'); Invoke-WebRequest ('https://nodejs.org/dist/' + $version + '/node-' + $version + '-win-x64.zip') -OutFile $archive; Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force; Copy-Item -Path (Join-Path $stage ('node-' + $version + '-win-x64\*')) -Destination $destination -Recurse -Force; Remove-Item -LiteralPath $archive -Force; Remove-Item -LiteralPath $stage -Recurse -Force"
  if errorlevel 1 (
    echo Could not download Node.js. Check your internet connection and try again.
    goto :failed
  )
)

if not exist "%NODE%" (
  echo Node.js setup did not complete successfully.
  goto :failed
)

call "%NPM%" ls --depth=0 >nul 2>nul
if errorlevel 1 goto :install_dependencies
goto :dependencies_ready

:install_dependencies
echo Installing Enzyla's npm dependencies. This may take a few minutes the first time...
call "%NPM%" ci --no-audit --no-fund
if errorlevel 1 (
  echo npm dependency setup failed. Check your internet connection and package-lock.json.
  goto :failed
)

:dependencies_ready
if /i "%~1"=="--generate-moon-lroc" goto :generate_lroc
if /i "%~1"=="--generate-moon-textures" goto :generate_wac
goto :start_app

:generate_lroc
echo Generating the global LROC color textures...
call "%NPM%" run generate:moon-lroc
if errorlevel 1 goto :failed
echo LROC textures generated in the public folder.
exit /b 0

:generate_wac
echo Regenerating the older WAC textures...
call "%NPM%" run generate:moon-textures
if errorlevel 1 goto :failed
echo WAC textures generated in the public folder.
exit /b 0

:start_app
echo Starting Enzyla...
start "Daryl API" /D "%ROOT%" "%NODE%" "daryl\server.js"
start "Enzyla Vite" /D "%ROOT%" "%NODE%" "node_modules\vite\bin\vite.js" --host 127.0.0.1 --strictPort
timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:5173/"
echo Enzyla is running at http://127.0.0.1:5173/
exit /b 0

:help
echo Usage:
echo   Enzyla.bat                         Start Enzyla
echo   Enzyla.bat --generate-moon-lroc    Generate LROC color textures
echo   Enzyla.bat --generate-moon-textures Regenerate the older WAC textures
echo.
echo LROC input: data\lroc_color_poles_8k.tif
echo WAC input:  data\LRO_WAC_Mosaic_Global_303ppd.tif
echo.
echo The Moon is a procedural sphere textured with LROC color and displaced at runtime
echo from ldem_16.tif, with elevation values in kilometers.
echo At close zoom, Moon Trek supplies global 256ppd ClrShade imagery and LOLA elevation
echo patches. Polar views use 30 m and 5 m LOLA DEMs where coverage allows. Terrain
echo patches shrink as you zoom in and fade back to the LDEM16 baseline at 1x scale.
echo The streamed ClrShade mosaic is composited onto the same terrain shown in the 2D panel.
exit /b 0

:missing_lroc
echo Required input not found: data\lroc_color_poles_8k.tif
goto :failed

:missing_wac
echo Required input not found: data\LRO_WAC_Mosaic_Global_303ppd.tif
echo Add the WAC TIFF at that path before regenerating its textures.
goto :failed

:failed
echo.
pause
exit /b 1
