@echo off
setlocal
chcp 65001 >NUL
cd /d "%~dp0"
title Candy Chaos 3D - Offline LAN (Host)
color 0B
echo.
echo ========================================================
echo    CANDY CHAOS 3D - GIOCA CON AMICI SENZA INTERNET
echo ========================================================
echo.
echo 1. Tutti i PC devono essere sullo STESSO Wi-Fi o hotspot.
echo 2. Mantieni APERTA questa finestra durante la partita.
echo 3. Se Windows chiede il firewall, consenti su RETI PRIVATE.
echo 4. Sui PC degli amici apri l'indirizzo 192.168...:3000
echo    che appare qui sotto (NON usare localhost dagli amici).
echo.
if not exist "%~dp0server.js" (
  echo [ERRORE] Manca server.js. Usa Estrai tutto sullo ZIP.
  pause
  exit /b 1
)
if not exist "%~dp0index.html" (
  echo [ERRORE] Manca index.html. Usa Estrai tutto sullo ZIP.
  pause
  exit /b 1
)
if exist "%~dp0node.exe" (
  set "NODE=%~dp0node.exe"
) else (
  where node >NUL 2>NUL
  if errorlevel 1 (
    echo [ERRORE] Manca node.exe. Scarica la versione COMPLETA Offline LAN.
    pause
    exit /b 1
  )
  set "NODE=node"
)
echo.
echo Lancio la pagina del gioco in Chrome/Edge...
start "Candy Chaos - Apertura Browser" /MIN cmd /c "timeout /t 3 /nobreak >NUL & start http://127.0.0.1:3000/"
echo.
"%NODE%" "%~dp0server.js"
echo.
echo [AVVISO] Il server si e' fermato. Premi un tasto per chiudere.
pause >NUL
endlocal
