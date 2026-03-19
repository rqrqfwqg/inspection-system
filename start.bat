@echo off
chcp 65001 >nul
title 管理系统启动器

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║          管理系统 - 一键启动                          ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: 获取当前目录
set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

:: 检查 Python 是否安装
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.x
    pause
    exit /b 1
)

:: 检查 Node.js 是否安装
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

echo [信息] 正在检查依赖...
echo.

:: 检查后端依赖
if not exist "backend\venv" (
    echo [信息] 首次运行，正在安装后端依赖...
    cd backend
    pip install -r requirements.txt -q
    cd ..
)

:: 检查前端依赖
if not exist "node_modules" (
    echo [信息] 首次运行，正在安装前端依赖...
    call npm install
)

echo.
echo [信息] 正在启动后端服务...
echo [信息] 后端地址: http://127.0.0.1:9527
echo [信息] API文档: http://127.0.0.1:9527/docs
echo.

:: 启动后端服务（新窗口）
start "管理系统 - 后端服务" cmd /k "cd /d "%ROOT_DIR%backend" && python -m uvicorn main:app --host 127.0.0.1 --port 9527"

:: 等待后端启动
timeout /t 3 /nobreak >nul

echo [信息] 正在启动前端服务...
echo [信息] 前端地址: http://localhost:5173
echo.

:: 启动前端服务（新窗口）
start "管理系统 - 前端服务" cmd /k "cd /d "%ROOT_DIR%" && npm run dev"

:: 等待前端启动
timeout /t 5 /nobreak >nul

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║              启动完成！                              ║
echo ╠══════════════════════════════════════════════════════╣
echo ║  前端地址: http://localhost:5173                     ║
echo ║  后端地址: http://127.0.0.1:9527                     ║
echo ║  API文档:  http://127.0.0.1:9527/docs                ║
echo ║                                                      ║
echo ║  默认账号: admin@example.com                         ║
echo ║  默认密码: admin123                                  ║
echo ╚══════════════════════════════════════════════════════╝
echo.

:: 自动打开浏览器
echo [信息] 3秒后自动打开浏览器...
timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo [提示] 关闭此窗口不会停止服务
echo [提示] 要停止服务，请关闭后端和前端服务窗口
echo.
pause
