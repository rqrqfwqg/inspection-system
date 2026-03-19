@echo off
chcp 65001 >nul
title 停止管理系统服务

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║          管理系统 - 停止服务                          ║
echo ╚══════════════════════════════════════════════════════╝
echo.

echo [信息] 正在停止后端服务 (Python/Uvicorn)...
taskkill /F /FI "WINDOWTITLE eq 管理系统 - 后端服务*" >nul 2>&1

echo [信息] 正在停止前端服务 (Node/Vite)...
taskkill /F /FI "WINDOWTITLE eq 管理系统 - 前端服务*" >nul 2>&1

:: 额外清理可能残留的进程
taskkill /F /IM "node.exe" /FI "WINDOWTITLE eq *vite*" >nul 2>&1
taskkill /F /IM "python.exe" /FI "WINDOWTITLE eq *uvicorn*" >nul 2>&1

echo.
echo [成功] 所有服务已停止
echo.
pause
