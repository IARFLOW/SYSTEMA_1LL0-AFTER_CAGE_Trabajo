@echo off
rem Systema 1LL0~ After Cage, las pantallas de este ordenador. Como se usa, en windows.ps1 y en README.md
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows.ps1" %*
if errorlevel 1 pause
