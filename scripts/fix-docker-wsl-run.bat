@echo off
set SF_FIX_DOCKER_NONINTERACTIVE=1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix-docker-wsl.ps1" >> "%~dp0fix-docker-wsl.log" 2>&1
