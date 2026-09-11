from fastapi import FastAPI, APIRouter, Depends, HTTPException, status, UploadFile, File, Header, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text as sa_text
from typing import List, Optional
from datetime import datetime, date, timezone
import os
import shutil
import uuid
import json
import time
from collections import defaultdict
from dotenv import load_dotenv

from database import get_db, init_db, User, Room
from schemas import (
    UserCreate, UserLogin, UserResponse, UserUpdate, UserPasswordUpdate,
    Token,
    RoomCreate, RoomUpdate, RoomResponse, RoomBatchImport,
)
from auth import verify_password, get_password_hash, create_access_token, decode_token
from cad_routes import router as cad_router
from asset_routes import router as asset_router, seed_assets
# 资产总台账（设备台账升级）：独立模块，避免 asset_routes 继续膨胀
from asset_ledger_routes import router as asset_ledger_router
from dependencies import get_current_user, require_admin, AUTH_DISABLED

from contextlib import asynccontextmanager

# 加载 .env 环境变量（必须在所有 os.getenv 调用之前）
load_dotenv()

# 默认管理员初始密码（首次启动创建时使用，应通过环境变量覆盖）
DEFAULT_ADMIN_PASSWORD = os.getenv("ADMIN_INIT_PASSWORD", "ChangeMe123!")

@asynccontextmanager
async def lifespan(app_instance):
    # 启动时初始化数据库
    init_db()
    db = next(get_db())
    # 初始化分系统资料管理种子数据
    try:
        seed_assets(db)
    except Exception as e:
        print(f"[初始化] 资料管理种子数据写入失败（可忽略，首次运行后已存在）：{e}")
    admin = db.query(User).filter(User.email == "admin@example.com").first()
    if not admin:
        admin = User(
            email="admin@example.com",
            name="管理员",
            phone="00000000000",
            password_hash=get_password_hash(DEFAULT_ADMIN_PASSWORD),
            role="admin"
        )
        db.add(admin)
        db.commit()
        print(f"[初始化] 已创建管理员账号 admin@example.com，请立即修改默认密码")

    # 上传路径命名空间迁移：/uploads/ -> /ops/uploads/（幂等，可与迁移脚本并存）
    try:
        db.execute(sa_text(
            "UPDATE users SET avatar = REPLACE(avatar, '/uploads/', '/ops/uploads/') "
            "WHERE avatar LIKE '/uploads/%'"
        ))
        db.commit()
        print("[迁移] 上传路径已命名为 /ops/uploads/（幂等）")
    except Exception as e:
        db.rollback()
        print(f"[迁移] 上传路径命名空间迁移跳过：{e}")

    db.close()
    yield

app = FastAPI(title="项目管理部运维系统 API", version="2.0.0", lifespan=lifespan)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 创建头像上传目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
AVATAR_DIR = os.path.join(BASE_DIR, "uploads", "avatars")
os.makedirs(AVATAR_DIR, exist_ok=True)

# 挂载静态文件目录（上传统一命名空间到 /ops/uploads，避免与其他系统冲突）
app.mount("/ops/uploads", StaticFiles(directory=os.path.join(BASE_DIR, "uploads")), name="ops-uploads")

# 挂载前端打包文件（静态资源统一命名空间到 /ops/assets）
DIST_DIR = os.path.join(os.path.dirname(BASE_DIR), "dist")
DIST_ASSETS_DIR = os.path.join(DIST_DIR, "assets")
if os.path.exists(DIST_ASSETS_DIR):
    app.mount("/ops/assets", StaticFiles(directory=DIST_ASSETS_DIR), name="ops-assets")

# 顶层 API 路由器：所有业务接口统一收口到 /ops/api
api_router = APIRouter(prefix="/ops/api")

# 子路由仅保留子路径前缀，由 api_router 拼装为 /ops/api/cad、/ops/api/assets
api_router.include_router(cad_router)      # /ops/api/cad/...
api_router.include_router(asset_router)    # /ops/api/assets/...
api_router.include_router(asset_ledger_router)  # /ops/api/assets/asset-ledger...

# ==================== 健康检查 ====================

@api_router.get("/health")
def health_check():
    """健康检查端点（Docker 存活探针）"""
    return {
        "status": "ok",
        "service": "项目管理部运维系统",
        "version": "2.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


# ==================== 登录限流 ====================

class LoginRateLimiter:
    """简单内存登录限流：每个 IP 每分钟最多尝试 5 次"""
    def __init__(self, max_attempts: int = 5, window_seconds: int = 60):
        self.attempts: dict = defaultdict(list)
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds

    def is_allowed(self, ip: str) -> bool:
        now = time.time()
        window_start = now - self.window_seconds
        # 清理过期记录
        self.attempts[ip] = [t for t in self.attempts[ip] if t > window_start]
        if len(self.attempts[ip]) >= self.max_attempts:
            return False
        self.attempts[ip].append(now)
        return True

login_limiter = LoginRateLimiter()


# ==================== 认证接口（无需登录） ====================

@api_router.post("/auth/login", response_model=Token)
def login(user_data: UserLogin, request: Request, db: Session = Depends(get_db)):
    # 免鉴权模式（内网开放）：忽略密码，直接返回 admin + 占位 token（兼容前端旧调用）
    if AUTH_DISABLED:
        admin = get_current_user(None, db)
        return Token(
            access_token="ops-bypass-token",
            token_type="bearer",
            user=UserResponse.model_validate(admin),
        )

    # 登录限流
    client_ip = request.client.host if request.client else "unknown"
    if not login_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="登录尝试过于频繁，请稍后再试")
    # 支持手机号或邮箱登录
    user = db.query(User).filter(
        (User.phone == user_data.phone) | (User.email == user_data.phone)
    ).first()
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="手机号或密码错误")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账户已被禁用，请联系管理员")
    access_token = create_access_token(data={"sub": user.email, "user_id": user.id})
    return Token(access_token=access_token, token_type="bearer", user=UserResponse.model_validate(user))

@api_router.post("/auth/register", response_model=UserResponse)
def register(user_data: UserCreate, db: Session = Depends(get_db)):
    """注册/创建用户（仅供管理员在用户管理页面调用，不对外开放自注册）"""
    if db.query(User).filter(User.email == user_data.email).first():
        raise HTTPException(status_code=400, detail="邮箱已被注册")
    if user_data.phone and db.query(User).filter(User.phone == user_data.phone).first():
        raise HTTPException(status_code=400, detail="手机号已被注册")
    password = user_data.password if user_data.password else "123456890"
    user = User(
        email=user_data.email,
        name=user_data.name,
        password_hash=get_password_hash(password),
        department=user_data.department,
        position=user_data.position,
        phone=user_data.phone,
        avatar=user_data.avatar
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)

# ==================== 用户管理接口 ====================

@api_router.get("/users", response_model=List[UserResponse])
def get_users(
    skip: int = 0,
    limit: int = 100,
    department: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取用户列表：管理员可查所有，普通用户只能查本部门"""
    query = db.query(User)
    if current_user.role != "admin":
        # 普通用户只能看本部门同事
        if current_user.department:
            query = query.filter(User.department == current_user.department)
        else:
            query = query.filter(User.id == current_user.id)
    else:
        if department:
            query = query.filter(User.department == department)
    if search:
        query = query.filter(
            (User.name.contains(search)) | (User.email.contains(search)) | (User.phone.contains(search))
        )
    return query.offset(skip).limit(limit).all()

@api_router.get("/users/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return UserResponse.model_validate(current_user)

@api_router.get("/users/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 普通用户只能查询自己或同部门
    if current_user.role != "admin" and current_user.id != user_id:
        if not current_user.department or current_user.department != user.department:
            raise HTTPException(status_code=403, detail="无权查看该用户信息")
    return UserResponse.model_validate(user)

@api_router.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, user_data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 普通用户只能修改自己的信息
    if current_user.role != "admin" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="无权修改其他用户信息")
    update_data = user_data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)

@api_router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """删除用户，仅管理员可操作"""
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 删除用户头像文件
    if user.avatar:
        try:
            avatar_path = os.path.join(BASE_DIR, user.avatar.lstrip("/"))
            if os.path.exists(avatar_path):
                os.remove(avatar_path)
        except Exception:
            pass
    db.delete(user)
    db.commit()
    return {"success": True, "message": "用户已删除"}

@api_router.post("/users/change-password")
def change_password(data: UserPasswordUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """修改密码：普通用户只能改自己的，管理员可改任意人的"""
    if current_user.role != "admin" and current_user.id != data.user_id:
        raise HTTPException(status_code=403, detail="无权修改其他用户密码")
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码错误")
    user.password_hash = get_password_hash(data.new_password)
    db.commit()
    return {"success": True, "message": "密码已更新"}

# ==================== 头像上传接口 ====================

@api_router.post("/upload/avatar")
async def upload_avatar(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """上传用户头像（命名空间 /ops/uploads）"""
    allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="只支持 JPG, PNG, GIF, WEBP 格式的图片")
    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片大小不能超过 5MB")
    file_ext = os.path.splitext(file.filename or "image.jpg")[1] or ".jpg"
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(AVATAR_DIR, unique_filename)
    with open(file_path, "wb") as f:
        f.write(content)
    avatar_url = f"/ops/uploads/avatars/{unique_filename}"
    return {"success": True, "avatar_url": avatar_url, "message": "头像上传成功"}

# ==================== 机房管理接口 ====================

@api_router.get("/rooms", response_model=List[RoomResponse])
def get_rooms(
    room_type: Optional[str] = None,
    building: Optional[str] = None,
    is_active: Optional[bool] = None,
    db: Session = Depends(get_db)
):
    """获取机房列表"""
    q = db.query(Room)
    if room_type:
        q = q.filter(Room.room_type == room_type)
    if building:
        q = q.filter(Room.building == building)
    if is_active is not None:
        q = q.filter(Room.is_active == is_active)
    return q.order_by(Room.building, Room.floor, Room.code).all()

@api_router.post("/rooms", response_model=RoomResponse)
def create_room(room_data: RoomCreate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """新增机房"""
    if db.query(Room).filter(Room.code == room_data.code).first():
        raise HTTPException(status_code=400, detail=f"机房编号 {room_data.code} 已存在")
    room = Room(**room_data.model_dump())
    db.add(room)
    db.commit()
    db.refresh(room)
    return room

@api_router.post("/rooms/batch", response_model=dict)
def batch_import_rooms(payload: RoomBatchImport, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """批量导入机房（已存在的按编号更新）"""
    created, updated = 0, 0
    for r in payload.rooms:
        existing = db.query(Room).filter(Room.code == r.code).first()
        if existing:
            for k, v in r.model_dump().items():
                setattr(existing, k, v)
            existing.updated_at = datetime.now(timezone.utc)
            updated += 1
        else:
            db.add(Room(**r.model_dump()))
            created += 1
    db.commit()
    return {"success": True, "created": created, "updated": updated, "total": created + updated}

@api_router.put("/rooms/{room_id}", response_model=RoomResponse)
def update_room(room_id: int, room_data: RoomUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """更新机房信息"""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="机房不存在")
    for k, v in room_data.model_dump(exclude_unset=True).items():
        setattr(room, k, v)
    room.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(room)
    return room

@api_router.delete("/rooms/{room_id}")
def delete_room(room_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_admin)):
    """删除机房"""
    room = db.query(Room).filter(Room.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="机房不存在")
    db.delete(room)
    db.commit()
    return {"success": True}

# 注册顶层 API 路由器（/ops/api 收口）
app.include_router(api_router)

# ==================== 前端 SPA 静态服务（/ops 命名空间） ====================

@app.get("/ops/vite.svg")
def serve_vite_svg():
    """返回 vite.svg 图标（命名空间 /ops）"""
    svg_path = os.path.join(DIST_DIR, "vite.svg")
    if os.path.exists(svg_path):
        return FileResponse(svg_path, media_type="image/svg+xml")
    return FileResponse(os.path.join(DIST_DIR, "index.html"), media_type="text/html")

@app.get("/ops")
@app.get("/ops/")
def serve_ops_index():
    """SPA 入口（命名空间 /ops）"""
    index_path = os.path.join(DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"error": "前端文件未找到，请先执行 npm run build"}

@app.get("/ops/{full_path:path}")
def serve_ops_spa(full_path: str):
    """SPA fallback：仅兜底 /ops 空间内未匹配路由，返回 index.html（避免吞掉其它顶层路由）"""
    index_path = os.path.join(DIST_DIR, "index.html")
    candidate = os.path.join(DIST_DIR, full_path)
    if os.path.isfile(candidate):
        return FileResponse(candidate)
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"error": "前端文件未找到，请先执行 npm run build"}

@app.get("/")
def root_redirect():
    """直连 IP:9527 时友好跳转到 /ops/（永久重定向，便于浏览器/代理缓存）"""
    return RedirectResponse("/ops/", status_code=301)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "9527"))
    # 默认只监听本机：生产由 nginx 443 反代，后端端口不对公网暴露。
    # 需直连调试时用 BACKEND_HOST=0.0.0.0 显式放开（务必同时收紧防火墙）。
    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, workers=1, loop="asyncio", lifespan="on")
