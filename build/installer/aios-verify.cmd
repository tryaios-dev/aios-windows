@echo off
rem Independent evidence verifier (apps/verifier-cli). Runs on the Node.js runtime inside AIOS.exe,
rem so an auditor needs nothing else installed:  aios-verify.cmd export.zip [more.zip] [--json]
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\AIOS.exe" "%~dp0dist\cli.js" %*
exit /b %ERRORLEVEL%
