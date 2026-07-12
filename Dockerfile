# ==================== 第一阶段：前端构建 ====================
# 注意：本仓库前端位于仓库根目录（package.json 在根，无 frontend/ 子目录）
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ==================== 第二阶段：后端运行 ====================
FROM python:3.13-slim
WORKDIR /app

# 安装系统依赖（ezdxf 需要 libGL）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# 安装后端依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend/ ./backend/
# 复制前端构建产物到 dist/（main.py 从 /app/dist 提供静态文件）
COPY --from=frontend-builder /app/dist/ ./dist/

ENV PYTHONUNBUFFERED=1
ENV DEV_MODE=false

EXPOSE 9527

CMD ["python", "backend/main.py"]
