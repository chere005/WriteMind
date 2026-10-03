@echo off
rem Sets up WriteMind on this Windows machine: Node.js if needed, packages,
rem a build, and Desktop / Start menu shortcuts. See tools\setup-windows.ps1.
rem   install.cmd            set up and build
rem   install.cmd -Package   also build the Windows installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-windows.ps1" %*
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the message above.
)
pause
