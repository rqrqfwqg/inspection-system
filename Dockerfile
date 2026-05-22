# === 第一阶段：前端构建 ===
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# === 第二阶段：后端运行 ===
FROM python:3.13-slim
WORKDIR /app

# 安装系统依赖（ezdxf 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

# 安装后端依赖
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend/ ./backend/
# 复制前端构建产物到 dist/
COPY --from=frontend-builder /app/frontend/dist/ ./dist/

ENV PYTHONUNBUFFERED=1
ENV DEV_MODE=false

EXPOSE 9527

CMD ["python", "backend/main.py"]
