@echo off
rem MultiMenu command line. Example: mm status   ^|   mm launch tag:farm   ^|   mm help
setlocal
set "MMOUT=%TEMP%\multimenu-cli-%RANDOM%%RANDOM%.txt"
"%~dp0MultiMenu.exe" --cli "--out=%MMOUT%" %*
set "MMRC=%ERRORLEVEL%"
if exist "%MMOUT%" (
  type "%MMOUT%"
  del "%MMOUT%" >nul 2>&1
)
exit /b %MMRC%
