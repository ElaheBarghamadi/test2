@echo off
setlocal EnableExtensions
set "PROJECT_ROOT=%~dp0.."
set "NODE_HOME="
for /d %%D in ("%PROJECT_ROOT%\.tools\node-v*-win-x64" "%PROJECT_ROOT%\.tools\node-v*-win-arm64") do (
  if exist "%%~fD\npm.cmd" set "NODE_HOME=%%~fD"
)
if not defined NODE_HOME (
  echo Local Node.js was not found.
  echo Run: powershell -ExecutionPolicy Bypass -File .\scripts\setup-local-node.ps1
  exit /b 1
)
call "%NODE_HOME%\npm.cmd" %*
