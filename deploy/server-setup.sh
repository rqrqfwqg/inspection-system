#!/usr/bin/env bash
# ============================================================
# inspection-system · 腾讯轻量云服务器端一键拉起脚本（纯进程版 · 无 Docker）
# ------------------------------------------------------------
# 运行前提（在你自己能 SSH 的终端里先做好）：
#   1) 把数据库推到服务器：        scp <本地 app.db 路径> <用户>@82.156.62.59:~/app.db
#   2) ssh 登录服务器，拿到代码：  git clone https://github.com/rqrqfwqg/inspection-system.git
#                                  （或用 inspection-system-deploy.tar.gz 解压）
#   3) cd inspection-system
#   4) 运行本脚本：                bash deploy/server-setup.sh
#
# 脚本会自动完成：
#   装运行环境(python3/node) → 注入生产环境变量 → 构建前端 → 放好数据库
#   → 启动后端进程(0.0.0.0:9527) → 健康检查
#
# 数据库正确位置是 backend/app.db（后端 database.py 默认读这里），
# 不要再走「Docker 挂载 ./data/app.db」那套老路径。
# ============================================================
set -e

# 切到项目根目录（无论在哪调用本脚本）
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> 项目根目录: $ROOT"

# ----------------------------------------------------------
# 0) 确保数据库就位（正确路径：backend/app.db）
# ----------------------------------------------------------
if [ -f backend/app.db ]; then
  echo "[ok] 已检测到 backend/app.db"
elif [ -f ~/app.db ]; then
  cp ~/app.db backend/app.db
  echo "[ok] 已将 ~/app.db 复制到 backend/app.db"
else
  echo "[警告] 未找到数据库文件。脚本将继续（首次启动 init_db 会自动建空库），"
  echo "        但不会有历史台账。若有真实数据，请先 scp 本地 app.db 到 ~/app.db 再运行。"
fi

# ----------------------------------------------------------
# 1) 生产环境变量（务必覆盖默认弱密码）
# ----------------------------------------------------------
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-$(openssl rand -hex 32)}"
export ADMIN_INIT_PASSWORD="${ADMIN_INIT_PASSWORD:-ChangeMe123!}"
export DEV_MODE=false
export PORT=9527

# ----------------------------------------------------------
# 2) 安装系统运行环境（python3 + node22），幂等
# ----------------------------------------------------------
echo "[*] 检查/安装系统依赖（python3, node）..."
if ! command -v python3 >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y python3 python3-venv python3-pip
fi

if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  echo "[*] 安装 Node 22（前端需要）..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v && python3 -V

# ----------------------------------------------------------
# 3) 后端依赖（虚拟环境）
# ----------------------------------------------------------
echo "[*] 安装 Python 依赖..."
python3 -m venv backend/venv
# shellcheck disable=SC1091
source backend/venv/bin/activate
pip install --upgrade pip -q
pip install -r backend/requirements.txt -q

# ----------------------------------------------------------
# 4) 前端构建（产出项目根 dist/，后端 StaticFiles 托管）
# ----------------------------------------------------------
echo "[*] 安装并构建前端（约 1-3 分钟）..."
npm install -q
npm run build

# ----------------------------------------------------------
# 5) 启动后端进程（nohup 保活，端口 9527）
# ----------------------------------------------------------
echo "[*] 启动后端进程..."
pkill -f "main.py" 2>/dev/null || true
sleep 1

cd "$ROOT/backend"
# shellcheck disable=SC1091
source venv/bin/activate
nohup python main.py > server.log 2>&1 &
echo $! > server.pid
echo "[ok] 后端已启动，PID=$(cat server.pid)，日志: backend/server.log"

# ----------------------------------------------------------
# 6) 健康检查
# ----------------------------------------------------------
sleep 5
if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  echo "[ok] 健康检查通过 ✅"
else
  echo "[!] 健康检查未通过，请查看 backend/server.log"
fi

echo ""
echo "============================================================"
echo " 访问地址:  http://<本机公网IP>:9527"
echo " 管理员:    admin / ${ADMIN_INIT_PASSWORD}"
echo " 数据库:    backend/app.db（已就位，重启不丢）"
echo " 停止:      kill \$(cat backend/server.pid)"
echo " 重启:      bash deploy/server-setup.sh"
echo "（如需开机自启/崩溃自愈，见 deploy/inspection.service 用 systemd 托管）"
echo "============================================================"
