@echo off
chcp 65001 >nul
title 重启后端服务

echo.
echo 正在停止后端服务...
taskkill /F /FI "WINDOWTITLE eq 管理系统 - 后端服务*" >nul 2>&1
taskkill /F /FI "IMAGENAME eq python.exe" /FI "WINDOWTITLE eq *uvicorn*" >nul 2>&1

timeout /t 2 /nobreak >nul

echo 正在启动后端服务...
cd /d "%~dp0backend"
start "管理系统 - 后端服务" cmd /k "python -m uvicorn main:app --host 127.0.0.1 --port 5000"

echo.
echo 后端服务已重启！
echo 请等待几秒后再试
echo.
pause
