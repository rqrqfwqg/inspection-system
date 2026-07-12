# 部署指南（腾讯云 CVM + Docker）

本系统已容器化，前后端打包为单一镜像，数据用 SQLite 本地卷持久化。以下是在**腾讯云 CVM** 上跑起来的最简流程（无需改代码）。

## 1. 准备腾讯云 CVM
- 机型建议：2 核 4G 及以上（Ubuntu 22.04 / TencentOS / CentOS 7+ 均可）。
- **安全组**：放通入站规则 `9527` 端口（TCP，来源 `0.0.0.0/0` 或你的办公网段）。若后续用 nginx 反代，则放通 `80/443`。
- 系统建议挂载一块云硬盘作为数据盘（SQLite 数据落在 `./data`，默认在系统盘也可）。

## 2. 安装 Docker 与 docker compose
```bash
# Ubuntu 示例
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
# 验证
docker --version && docker compose version
```

## 3. 获取代码
```bash
git clone https://github.com/rqrqfwqg/inspection-system.git
cd inspection-system
```

## 4. 配置生产环境变量
后端通过 `backend/.env` 读取密钥（已 gitignore，不会进仓库）：
```bash
cp backend/.env.example backend/.env
# 生成强随机 JWT 密钥
openssl rand -hex 32
```
编辑 `backend/.env`：
```
JWT_SECRET_KEY=<上一步生成的随机串>
ADMIN_INIT_PASSWORD=<你的管理员初始密码>
DEV_MODE=false
PORT=9527
```
> ⚠️ 生产环境**务必** `DEV_MODE=false`，否则任何人可绕过登录。
> `docker-compose.yml` 已默认 `DEV_MODE=false` 并带 healthcheck，环境变量以 `backend/.env` 或 compose environment 为准（两者同时存在时系统环境变量优先）。

## 5. 构建并启动
```bash
docker compose up -d --build
```
- 首次构建会安装前端依赖并打包（约 1-3 分钟），后端用 `python backend/main.py` 启动于 `0.0.0.0:9527`。
- 查看日志：`docker compose logs -f`
- 健康检查：`curl http://localhost:9527/api/health`

## 6. 访问与初始化
浏览器打开 `http://<CVM公网IP>:9527`，使用管理员账号登录：
- 默认管理员：`admin` / 你在 `ADMIN_INIT_PASSWORD` 设的密码（首次启动自动创建）。

数据（SQLite + 上传文件）持久化在宿主机 `./data/` 目录，容器重建不丢。

## 7. 升级
```bash
git pull
docker compose up -d --build
```

## 8.（可选）域名 + HTTPS 反代
如需用域名访问，在 CVM 上再跑一个 nginx 反代到 `127.0.0.1:9527`，并申请免费证书：
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

## 9. 后续可平滑升级（无需改代码）
- **换云数据库**：把 `backend/.env` 的 `DATABASE_URL` 指向腾讯云数据库 PostgreSQL/MySQL（如 `postgresql://user:pass@<内网地址>:5432/inspection`），`database.py` 已支持。
- **换对象存储**：上传文件当前落在本地 `./data/uploads`，后续可接腾讯云 COS（改 `backend/` 上传逻辑即可）。
- **多副本**：当前 SQLite 为单机文件，若需横向扩展再迁云数据库 + 无状态化。

## 镜像构建说明
- `Dockerfile` 两阶段：`node:22-alpine` 构建前端（仓库根目录 `npm run build` → `dist/`），`python:3.13-slim` 运行后端并挂载 `dist/`。
- `.dockerignore` 已排除 `node_modules`、`dist`、`.git`、`docs`、`scripts` 等，缩小构建上下文。
- CI（`.github/workflows/ci.yml`）在每次 push 到 `main` 时自动跑前端类型检查 + 构建 + 后端语法检查 + Docker 镜像构建验证。
