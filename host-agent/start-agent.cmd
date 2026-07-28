@echo off
REM Inicia el agente de remontaje de ubeFlix en el host.
REM Doble clic para arrancarlo, o agregalo al inicio de Windows (ver README.md).
cd /d "%~dp0.."
node host-agent\remount-agent.js
pause
