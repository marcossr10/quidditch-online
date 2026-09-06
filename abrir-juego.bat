@echo off
setlocal
set PORT=4173
set "SELF=%~dp0"
if "%SELF:~-1%"=="\" set "SELF=%SELF:~0,-1%"

echo ============================================================
echo  Quidditch Manager - lanzador
echo  Carpeta del juego: %SELF%
echo ============================================================
echo.

echo Cerrando servidores antiguos del puerto %PORT%
echo (por si quedaban levantados desde otra carpeta de copia)...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop; Write-Host ('  Cerrado PID ' + $_.OwningProcess) } catch {} }; Start-Sleep -Milliseconds 500 }"
echo.

cd /d "%SELF%"

set "RUNNER="

rem Se prefiere el lanzador py (mas fiable que el alias python de la Store)
where py >nul 2>nul
if %errorlevel%==0 set "RUNNER=py -m http.server %PORT% --bind 127.0.0.1 --directory "%SELF%""

if not defined RUNNER (
  where python >nul 2>nul
  if %errorlevel%==0 set "RUNNER=python -m http.server %PORT% --bind 127.0.0.1 --directory "%SELF%""
)

if not defined RUNNER (
  echo No se encontro Python ni el lanzador py.
  echo Abre una terminal en la carpeta del proyecto y ejecuta:
  echo   py -m http.server %PORT% --bind 127.0.0.1 --directory "%SELF%"
  pause
  exit /b 1
)

echo Lanzando el servidor...
echo   %RUNNER%
start "" /b %RUNNER%

timeout /t 2 /nobreak >nul

powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { Write-Host 'Servidor OK: http://127.0.0.1:%PORT%/' } else { Write-Host 'ATENCION: el servidor no arranco. Prueba a abrir una terminal en la carpeta y ejecutar:'; Write-Host '  py -m http.server %PORT% --bind 127.0.0.1 --directory "%SELF%"' }"

start "" "http://127.0.0.1:%PORT%/"

echo.
echo Juego servido desde: %SELF%
echo Comprueba que el juego muestra "Version 3" en la pantalla de elegir club
echo y en la barra superior. Si aun ves la version antigua, pulsa Ctrl+F5
echo en el navegador para limpiar la cache.
echo.
