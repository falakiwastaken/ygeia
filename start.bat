@echo off
REM Ygeia - double-click this to run the app locally.
REM Serves the folder over HTTP and opens it in your browser.
REM Close this window to stop the server.

cd /d "%~dp0"

REM Give the server a moment to bind before the browser asks for the page.
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start """" http://localhost:8123/"

echo Ygeia running at http://localhost:8123/
echo On your phone (same WiFi), use this machine's IP on port 8123.
echo Close this window to stop.
echo.

python -m http.server 8123
