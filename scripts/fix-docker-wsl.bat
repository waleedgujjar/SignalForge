@echo off
:: Double-click this file and choose "Run as administrator"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-docker-wsl.ps1"
pause
