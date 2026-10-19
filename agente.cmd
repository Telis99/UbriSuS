@echo off
rem Inicia o super agente local do UbriSUS (Ollama + Qwen 3.5 4B).
cd /d "%~dp0"
node ia-local\superagente.mjs %*
if errorlevel 1 pause
