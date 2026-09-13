@echo off
setlocal
set "ROOT=%~dp0"
set "MUSICHE_NODE=%ROOT%runtime\node.exe"
set "MUSICHE_DATA=%ROOT%data"
set "PORT=54821"
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "MUSICHE_CLOUD_COOKIE="
if not exist "%MUSICHE_NODE%" (
  echo Missing runtime\node.exe
  pause
  exit /b 1
)
if not exist "%ROOT%app\node_modules\electron\dist\electron.exe" (
  echo Missing Electron
  pause
  exit /b 1
)
if not exist "%ROOT%app\web\dist\index.html" (
  echo Missing frontend web\dist
  pause
  exit /b 1
)
if not exist "%MUSICHE_DATA%" mkdir "%MUSICHE_DATA%"
cd /d "%ROOT%app"
start "" /D "%ROOT%app" "%ROOT%app\node_modules\electron\dist\electron.exe" "%ROOT%app\electron\main.mjs"
