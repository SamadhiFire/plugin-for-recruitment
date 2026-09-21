@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "NODE_EXE="
for %%N in ("D:\Program Files\nodejs\node.exe" "%ProgramFiles%\nodejs\node.exe" "%ProgramFiles(x86)%\nodejs\node.exe" "%LocalAppData%\Programs\nodejs\node.exe") do (
  if not defined NODE_EXE if exist "%%~fN" set "NODE_EXE=%%~fN"
)
if not defined NODE_EXE (
  for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
)
if not defined NODE_EXE (
  echo Node.js was not found. Install Node.js 20+ from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
echo Starting Recruitment Resume Copilot. Keep this window open while using the extension.
"%NODE_EXE%" server\server.mjs
echo Local service stopped.
pause
