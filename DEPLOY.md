# 部署指南（腾讯轻量云 · 纯进程版，无 Docker）

本系统前后端一体运行：后端用 FastAPI/uvicorn 启动，前端 `npm run build` 产出 `dist/` 后由后端 `StaticFiles` 同源托管（均走 `9527` 端口），数据用 SQLite 单文件（`backend/app.db`）持久化。**无需容器**，以下是在**腾讯轻量云**上跑起来的最简流程（不改动业务代码）。

## 1. 准备腾讯轻量云
- 机型建议：2 核 4G 及以上（Ubuntu 22.04 推荐）。
- **安全组**：放通入站规则 `9527` 端口（TCP，来源 `0.0.0.0/0` 或你的办公网段）。若后续用 nginx 反代，则放通 `80/443`。
- 系统盘即可，数据库与上传文件都落在项目目录内（`backend/app.db`、`backend/uploads`）。

## 2. 获取代码
```bash
# 方式 A：git clone（需服务器能连 GitHub，国内可能不稳定）
git clone https://github.com/rqrqfwqg/inspection-system.git
cd inspection-system

# 方式 B：用部署包（已从我本地打好、绕开 GitHub，推荐）
#   本地：scp inspection-system-deploy.tar.gz <用户>@82.156.62.59:~/
#   服务器：mkdir -p ~/inspection-system && tar -xzf ~/inspection-system-deploy.tar.gz -C ~/inspection-system && cd ~/inspection-system
```

## 3. 导入已录入的真实数据（关键，且是唯一正确路径）
本地开发机已录入 **1608 条台账记录 + 314 条关联边**（`backend/app.db`，SQLite 单文件、`journal_mode=delete` 可整体拷贝）。**不要重跑导入脚本**，直接把该文件传到服务器：

```bash
# ① 在你本地（能 SSH 的终端）把数据库推到服务器家目录
scp "C:/Users/yan/WorkBuddy/2026-05-21-13-28-45/inspection-system/backend/app.db" <用户>@82.156.62.59:~/app.db

# ② ssh 登录服务器，把库放到 backend/ 下（这就是后端真正读库的位置）
ssh <用户>@82.156.62.59
cd ~/inspection-system
cp ~/app.db backend/app.db        # ✅ 正确路径：backend/app.db（不是 Docker 的 ./data/app.db）
```
> ⚠️ 数据库含真实台账，**请勿**提交到 Git（`.gitignore` 已忽略 `*.db`）。
>
> 若服务器上想**重新从 Excel 导入**而非拷贝库文件，可把 3 份 Excel 传到 `scripts/` 后运行
> `cd backend && source venv/bin/activate && python ../scripts/import_real_assets.py`（需先 `bash deploy/server-setup.sh` 建好 venv 与环境）。

## 4. 一键拉起（装环境 + 构建前端 + 启动后端）
```bash
bash deploy/server-setup.sh
```
脚本会自动：装 python3/node → 注入生产环境变量 → `pip install` 后端依赖 → `npm run build` 前端 → 把 `~/app.db` 落到 `backend/app.db`（若已在该位置则跳过）→ `nohup` 启动后端 → 健康检查。

启动后访问 `http://<公网IP>:9527`，首次会自动建管理员账号：
- 默认管理员：`admin` / 你在 `ADMIN_INIT_PASSWORD` 设的密码（脚本随机生成并打印）。

## 5. 环境变量（生产务必改）
后端通过 `backend/.env` 读取（已 gitignore）：
```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env：
JWT_SECRET_KEY=<openssl rand -hex 32 生成的随机串>
ADMIN_INIT_PASSWORD=<你的管理员初始密码>
DEV_MODE=false
PORT=9527
```
> ⚠️ 生产环境**务必** `DEV_MODE=false`，否则任何人可绕过登录。
> 若用 systemd 托管（见第 7 节），`EnvironmentFile` 指向该 `.env`。

## 6. 日常运维
```bash
# 停止
kill $(cat backend/server.pid)
# 重启（重新构建并启动）
bash deploy/server-setup.sh
# 看日志
tail -f backend/server.log
# 健康检查
curl http://localhost:9527/api/health
```

## 7.（推荐生产）systemd 托管（开机自启 + 崩溃自愈）
`deploy/inspection.service` 已提供单元文件。在服务器上（root）：
```bash
sudo cp deploy/inspection.service /etc/systemd/system/inspection.service
# 编辑文件，把 User= 与路径改成你的实际用户名/目录
sudo nano /etc/systemd/system/inspection.service
sudo systemctl daemon-reload
sudo systemctl enable --now inspection
# 之后： sudo systemctl status|restart|stop inspection
```
注意：systemd 方式下需先 `bash deploy/server-setup.sh` 建好 `backend/venv` 与 `backend/app.db`，再启用服务。

## 8.（可选）域名 + HTTPS 反代
如需域名访问，在 CVM 上另跑 nginx 反代到 `127.0.0.1:9527` 并申请免费证书：
```nginx
server {
    listen 443 ssl;
    server_name your.domain.com;
    ssl_certificate     /path/fullchain.pem;
    ssl_certificate_key /path/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:9527;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
前端 `VITE_API_URL=/api` 已配置为同域相对路径，反代后无需改任何代码。

## 9. 后续可平滑升级（无需改业务代码）
- **换云数据库**：把 `backend/.env` 的 `DATABASE_URL` 指向腾讯云 PostgreSQL/MySQL（如 `postgresql://user:pass@<内网地址>:5432/inspection`），`database.py` 已支持。
- **换对象存储**：上传文件当前落在本地 `backend/uploads`，后续可接腾讯云 COS（改 `backend/` 上传逻辑即可）。
- **多副本**：当前 SQLite 为单机文件，若需横向扩展再迁云数据库 + 无状态化。

## 关于 CI
`.github/workflows/ci.yml` 在每次 push 到 `main` 时自动跑：前端类型检查 + 构建、后端语法 + 导入检查（代码质量门禁）。**不含任何镜像/容器构建**，服务器侧部署由 `deploy/server-setup.sh` 负责。
