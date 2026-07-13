"""共享鉴权依赖（由 main.py 与 asset_routes.py 合并而来，消除重复实现）

设计要点：
- `DISABLE_AUTH` 为生产内网开放开关，`DEV_MODE` 为开发跳过开关；
  二者任一为 true 即 `AUTH_DISABLED`（免鉴权 admin 模式）。
- `get_current_user` / `require_admin`：`AUTH_DISABLED` 时直接返回 admin 用户，
  否则保持原 JWT 校验逻辑不变。
"""
import os
from typing import Optional

from dotenv import load_dotenv

# 必须在读取环境变量前加载 .env（本模块在 import 期即读取 DISABLE_AUTH/DEV_MODE，
# 而 main.py 的 load_dotenv() 在其 import 之后才执行，故此处先行加载，确保幂等）。
load_dotenv()

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db, User
from auth import get_password_hash, decode_token


DEV_MODE = os.getenv("DEV_MODE", "false").lower() in ("true", "1")
DISABLE_AUTH = os.getenv("DISABLE_AUTH", "false").lower() in ("true", "1")
# 任一开关为真即进入免鉴权模式（内网开放、自动 admin）
AUTH_DISABLED = DEV_MODE or DISABLE_AUTH


def _ensure_admin(db: Session) -> User:
    """返回库里第一个 role='admin' 的用户；不存在则合成一个。"""
    admin = db.query(User).filter(User.role == "admin").first()
    if admin:
        return admin
    admin = User(
        email="admin@system.local",
        name="系统管理员",
        phone="00000000000",
        password_hash=get_password_hash("admin123456"),
        role="admin",
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """获取当前登录用户。

    - AUTH_DISABLED（免鉴权模式）：直接返回 admin，不校验 token。
    - 否则：校验 Bearer token，失败抛出 401。
    """
    if AUTH_DISABLED:
        return _ensure_admin(db)

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")

    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="令牌格式错误")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账户已被禁用，请联系管理员")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """要求当前用户是管理员；否则抛出 403。"""
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return current_user
