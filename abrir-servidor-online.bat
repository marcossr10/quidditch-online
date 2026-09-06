@echo off
setlocal
set "SELF=%~dp0server"

echo ============================================================
echo  Quidditch Manager - servidor online
echo  Carpeta del servidor: %SELF%
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%SELF%\node_modules\ws" (
  echo Instalando dependencias, solo la primera vez...
  cd /d "%SELF%"
  call npm install
  echo.
)

cd /d "%SELF%"
echo Servidor online en: ws://localhost:8787
echo Deja ESTA ventana abierta mientras juegues online.
echo.
call npm start
pause
