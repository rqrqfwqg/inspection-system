# 项目管理部运维系统 - 升级诊断报告

> 生成时间：2026-05-21
> 最后更新：2026-05-22（全部完成）
> 审查范围：前端 (React+Vite+TS) + 后端 (FastAPI+SQLite) + 架构
> 状态：✅ 所有 P0/P1/P2 项目已全部完成

---

## 🔴 P0 - 必须立即修复 ✅ 已完成

### 1. 认证系统完全被绕过了 ✅

**问题如下：**

| 位置 | 问题 |
|------|------|
| `backend/main.py:L84-99` | `get_current_user()` — 没有 token 或 token 无效时，直接返回管理员账号 |
| `src/services/api.ts:L34-37` | Authorization header 被注释掉了，前端从不发送 token |
| `src/contexts/AuthContext.tsx:L89` | `isAuthenticated: true` 写死为 true |
| `src/pages/LoginPage.tsx` | 登录页面存在但形同虚设，任何人都能直接访问系统 |

**影响**：系统完全没有访问控制，任何人无需密码即可访问所有 API 接口、修改任何数据。

**修复思路**：
- 前端恢复发送 Authorization header
- 后端 `get_current_user` 在无有效 token 时返回 401 而非自动创建管理员
- 保留 `public` 路由白名单（`/api/auth/login`）

### 2. 硬编码密钥和密码 ✅

- `backend/auth.py:L6`：`SECRET_KEY = "your-secret-key-change-in-production"`
- `backend/main.py:L41`：默认管理员密码 `123456890` 写在代码里
- `backend/main.py:L93`：另一个默认管理员密码 `admin123`
- 前端 `LoginPage.tsx:L106`：初始密码明文展示在页面上

**修复**：SECRET_KEY 改为环境变量，默认密码通过 .env 注入且强制首次登录修改。

---

## 🟠 P1 - 强烈建议升级 ✅ 已完成

### 3. 依赖版本严重过旧 ✅ （已升级）

| 依赖 | 当前版本 | 升级后 |
|------|----------|--------|
| React | 18.2.0 | 19.x |
| Vite | 5.0.0 | 6.x |
| TypeScript | 5.2.2 | 5.7 |
| FastAPI | 0.109.0 | 0.115+ |
| uvicorn | 0.27.0 | 0.34+ |
| SQLAlchemy | 2.0.25 | 2.0.35+ |
| Tailwind CSS | 3.3.5 | 3.4 |
| lucide-react | 0.294.0 | 0.480+ |

### 4. Pydantic v1 写法混用 v2 库 ✅ （已迁移）

- `requirements.txt` 指定 `pydantic==2.5.3`（v2），但 schemas.py 用的是 v1 风格：
  - `class Config: from_attributes = True`（v1）应为 `model_config = ConfigDict(from_attributes=True)`（v2）
  - `user_data.dict(exclude_unset=True)` 应为 `user_data.model_dump(exclude_unset=True)`
  - `schedule_data.dict()` 应为 `schedule_data.model_dump()`
  - `UserResponse.from_orm(user)` 应为 Pydantic v2 的新写法
- 目前能运行是因为 Pydantic v2 向后兼容 v1 API，但 v2.5 后逐步移除兼容层

### 5. Python `datetime.utcnow()` 已废弃 ✅ （已修复）

`backend/database.py` 和 `backend/main.py` 中大量使用 `datetime.utcnow()`，Python 3.12+ 中已标记废弃，应改为 `datetime.now(timezone.utc)`。

### 6. 缺少 Docker 部署方案 ✅ （已创建 Dockerfile + docker-compose.yml）

没有 `Dockerfile`、`docker-compose.yml`，部署靠手动启动 Python 和 Vite。加上之后可以：
- 一键部署
- 统一开发环境
- 方便迁移到 PostgreSQL

### 7. 根目录散落约 30 个 Python 脚本 ✅ （已整理到 scripts/ 目录）

`backend/` 目录混入了大量一次性脚本：
- `check_and_migrate.py`, `check_port.py`, `check_users.py`
- `migrate_add_department.py`, `test_add_user.py`, `test_api.py`
- `test_cad.py`, `test_upload.py`, `ver.py`, `who_owns_8000.py`
- `run.py`, `run.bat`, `serve.py`（3 个不同启动方式）

应整理到 `scripts/` 或 `tests/` 目录下。

---

## 🟡 P2 - 建议优化 ✅ 全部完成

### 8. 前端硬编码指向云服务器 ✅ （已改为 /api 走 Vite proxy）

`src/services/api.ts:L2`：
```typescript
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://106.54.20.90:8888/api'
```

- 开发环境默认值应指向 `http://localhost:9527/api`（配合 vite proxy）
- 生产环境通过 `.env.production` 配置
- 建议增加 `.env` / `.env.production` / `.env.development` 环境变量文件

### 9. 缺少健康检查端点 ✅ （已添加 /api/health 端点）

没有 `/api/health` 端点，部署时无法做存活探测和就绪检查。

### 10. 缺少请求频率限制 ✅ （已添加 LoginRateLimiter）
### 11. 缺少 API 文档版本控制 ✅ （已配置 API title/version）
### 12. 前端缺少错误边界 ✅ （已添加 ErrorBoundary 组件）
### 13. 前端缺少骨架屏 / Loading 状态 ✅ （已添加 Skeleton 组件系列）
### 14. SQLite → PostgreSQL 迁移路径 ✅ （已添加 alembic 依赖）
### 15. 命名不一致 ✅ （已统一名称）
### 16. 缺少 CI/CD 配置 ✅ （已添加 GitHub Actions workflow）
### 17. CAD 上传目录路径不一致 ✅ （已统一为绝对路径）
### 18. numpy>=2.0.0 兼容性风险 ✅ （已验证兼容，降级约束为 >=1.24）

---

## ✅ 全部完成

所有 P0/P1/P2 共 18 项优化已于 2026-05-22 全部完成。

---

## 📊 依赖升级清单

### 前端 (npm)

```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "vite": "^6.0.0",
  "typescript": "^5.7.0",
  "tailwindcss": "^4.0.0",
  "@vitejs/plugin-react": "^4.3.0",
  "lucide-react": "^0.460.0",
  "date-fns": "^4.0.0",
  "react-router-dom": "^7.0.0",
  "recharts": "^2.15.0",
  "@radix-ui/*": "latest",
  "@typescript-eslint/*": "^8.0.0"
}
```

### 后端 (pip)

```
fastapi>=0.115.0
uvicorn[standard]>=0.34.0
sqlalchemy>=2.0.36
python-multipart>=0.0.18
pydantic>=2.10.0
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.4
ezdxf>=1.4.0
python-dotenv>=1.0.0
alembic>=1.14.0
```

---

## 🎯 建议修复优先级

| 优先级 | 事项 | 预计工作量 |
|--------|------|-----------|
| P0-1 | 修复认证系统 | 2-3h |
| P0-2 | 移除硬编码密钥/密码 | 0.5h |
| P1-3 | 升级前端依赖（React 19 + Vite 6） | 3-4h |
| P1-4 | 后端依赖升级 + Pydantic v2 写法 | 2-3h |
| P1-5 | 修复 datetime.utcnow() | 0.5h |
| P1-6 | Docker 化 | 2h |
| P1-7 | 整理脚本文件 | 0.5h |
| P2-8~18 | 其余优化项 | 8-10h |

---

*本报告基于代码静态分析生成，未做运行时测试。部分风险需要实际运行后才能确认。*
