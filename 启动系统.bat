@echo off
chcp 65001 >nul
title 管理系统启动器

echo.
echo  [1/4] 关闭旧进程...
taskkill /F /IM python.exe /T >nul 2>&1
ping -n 2 127.0.0.1 >nul

echo  [2/4] 启动后端 (http://127.0.0.1:9527)...
start "管理系统-后端" cmd /k "cd /d %~dp0backend && python -m uvicorn main:app --host 127.0.0.1 --port 9527"

echo  [3/4] 等待后端就绪...
ping -n 4 127.0.0.1 >nul

echo  [4/4] 启动前端 (http://localhost:5173)...
start "管理系统-前端" cmd /k "cd /d %~dp0 && npm run dev"

ping -n 6 127.0.0.1 >nul

echo.
echo  启动完成！正在打开浏览器...
echo  前端: http://localhost:5173
echo  后端: http://127.0.0.1:9527
echo  API文档: http://127.0.0.1:9527/docs
echo.
start http://localhost:5173
pause
