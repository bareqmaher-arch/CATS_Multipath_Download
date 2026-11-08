@echo off
rem Starts the real-network campaign: campaign.cmd -Server <IP> -Prefix <random path>. Keep this window open.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0campaign.ps1" %*
pause
