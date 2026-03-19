@echo off
chcp 65001 >nul
echo [1/2] Starting backend...
start "Backend" cmd /k "cd /d %~dp0backend && python run.py"
timeout /t 4 /nobreak >nul
echo [2/2] Starting frontend...
start "Frontend" cmd /k "cd /d %~dp0 && npm run dev"
timeout /t 5 /nobreak >nul
start http://localhost:5173
echo Done. Check the two cmd windows for status.
