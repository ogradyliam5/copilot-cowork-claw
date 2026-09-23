@echo off
rem Claw PC launcher: double-click to start. Installs PowerShell 7 if needed, then runs claw.ps1.
setlocal
title Claw PC
cd /d "%~dp0"

if not exist "%~dp0claw.ps1" (
  echo.
  echo   Please extract the whole zip first: right-click it, choose Extract All,
  echo   then open the extracted folder and double-click Start-Claw.cmd there.
  echo.
  pause
  exit /b 1
)

set "PWSH="
where pwsh >nul 2>nul && set "PWSH=pwsh"
if not defined PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined PWSH (
  echo Installing PowerShell 7 - approve any Windows prompt...
  winget install --id Microsoft.PowerShell --exact --source winget --accept-source-agreements --accept-package-agreements
  if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
)
if not defined PWSH (
  echo.
  echo   Couldn't install PowerShell 7. Install it from https://aka.ms/powershell
  echo   and then double-click Start-Claw.cmd again.
  echo.
  pause
  exit /b 1
)

"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0claw.ps1" %*
set "CODE=%ERRORLEVEL%"
echo.
pause
exit /b %CODE%
