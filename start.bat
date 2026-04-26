@echo off
title eBet-Turbo v1
color 0A

cd /d "%~dp0"

echo Regi folyamatok leallitasa...
taskkill /FI "WINDOWTITLE eq eBet-Szerver" /F >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3005.*LISTENING" 2^>nul') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5180.*LISTENING" 2^>nul') do taskkill /F /PID %%p >nul 2>&1
timeout /t 2 /nobreak >nul

echo Szerver inditasa...
start "eBet-Szerver" /d "%~dp0" cmd /k "npm run server"

echo Varakozas...
timeout /t 5 /nobreak >nul

echo Bongeszo megnyitasa...
start "" http://localhost:5180

echo.
echo  ============================================
echo   eBet-Turbo v1 - ELINDULT
echo  ============================================
echo.
echo   Dashboard : http://localhost:5180
echo   Szerver   : http://localhost:3005
echo.
echo   LEALLITAS:
echo   1. Ebben az ablakban nyomj CTRL+C
echo   2. Majd zarjuk be az eBet-Szerver ablakot
echo  ============================================
echo.
npm run dev

pause
