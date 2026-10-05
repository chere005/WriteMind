@echo off
rem Panic button: lets the cursor and the pen go free. Safe to run at any time. See free-pen.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0free-pen.ps1"
echo.
pause
