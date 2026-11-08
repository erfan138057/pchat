@echo off
setlocal EnableExtensions
title pchat - install

rem Create a "pchat" command in %APPDATA%\npm (already on PATH when Node.js is installed)
rem that points at this folder. Remove that file to uninstall.

set "HERE=%~dp0"
if "%HERE:~-1%"=="\" set "HERE=%HERE:~0,-1%"
set "JS=%HERE%\bin\pchat.js"

if not exist "%JS%" (
  echo.
  echo  [pchat] bin\pchat.js not found next to this script.
  echo.
  pause
  exit /b 1
)

set "DEST=%APPDATA%\npm"
if not exist "%DEST%\" (
  echo.
  echo  [pchat] %DEST% does not exist.
  echo          Install Node.js first ^(it creates this folder^), or add "%HERE%" to PATH
  echo          and run pchat.cmd from there.
  echo.
  pause
  exit /b 1
)

> "%DEST%\pchat.cmd" echo @echo off
>> "%DEST%\pchat.cmd" echo node "%JS%" %%*

if not exist "%DEST%\pchat.cmd" (
  echo.
  echo  [pchat] Could not write %DEST%\pchat.cmd
  echo.
  pause
  exit /b 1
)

echo.
echo  [pchat] Installed.
echo.
echo    command : pchat
echo    points  : %JS%
echo    shim    : %DEST%\pchat.cmd
echo.
echo  Open a NEW terminal window, then type: pchat
echo  To uninstall, delete: %DEST%\pchat.cmd
echo.
pause
