#!/usr/bin/env bash
# ============================================================
# inspection-system · 腾讯轻量云服务器端一键拉起脚本
# 运行前提（在你自己能 SSH 的终端里先做好）：
#   1) 本地 scp 把数据库推到服务器：  scp <本地app.db路径> <用户>@82.156.62.59:~/app.db
#   2) ssh 登录服务器后，clone 代码：  git clone https://github.com/rqrqfwqg/inspection-system.git
#   3) cd inspection-system
#   4) 运行本脚本：                     bash deploy/server-setup.sh
# 脚本会自动：放置数据库 → 装 Docker（若缺）→ 注入生产环境变量 → 构建并启动
# ============================================================
set -e

# 1) 确保数据库就位（优先用已 scp 过来的 ~/app.db，其次用已存在的 ./data/app.db）
if [ -f data/app.db ]; then
  echo "[ok] 已检测到 ./data/app.db"
elif [ -f ~/app.db ]; then
  mkdir -p data && mv ~/app.db data/app.db
  echo "[ok] 已将 ~/app.db 移入 ./data/app.db"
else
  echo "[错误] 未找到数据库文件。请先：scp 本地 app.db 到本机 ~/app.db，再运行本脚本" >&2
  exit 1
fi

# 2) 安装 Docker（若未安装）
if ! command -v docker >/dev/null 2>&1; then
  echo "[*] 未检测到 Docker，开始安装..."
  curl -fsSL https://get.docker.com | sudo bash
  sudo systemctl enable --now docker
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "[错误] Docker 安装失败，请手动安装后重试" >&2
  exit 1
fi

# 3) 生产环境变量（务必覆盖默认弱密码）
export JWT_SECRET_KEY="${JWT_SECRET_KEY:-$(openssl rand -hex 32)}"
export ADMIN_INIT_PASSWORD="${ADMIN_INIT_PASSWORD:-ChangeMe123!}"
export DEV_MODE=false
export PORT=9527

# 4) 构建并启动
echo "[*] 构建并启动容器（首次约 2-5 分钟）..."
docker compose up -d --build

# 5) 健康检查
sleep 6
if curl -fsS http://localhost:9527/api/health >/dev/null 2>&1; then
  echo "[ok] 健康检查通过 ✅"
else
  echo "[!] 健康检查未通过，请执行: docker compose logs 排查"
fi

echo ""
echo "============================================================"
echo " 访问地址:  http://<本机公网IP>:9527"
echo " 管理员:    admin / ${ADMIN_INIT_PASSWORD}"
echo " 数据库:    ./data/app.db（已挂载持久化，重启不丢）"
echo " 常用命令:  docker compose ps | logs -f | restart | down"
echo "============================================================"
