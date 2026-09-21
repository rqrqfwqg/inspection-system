from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime

# User schemas
class UserBase(BaseModel):
    email: str
    name: str
    username: Optional[str] = None                        # 登录账号（英文名），2026-09-21 新增
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    phone: str
    password: str

class FastLoginRequest(BaseModel):
    """免密直登请求体（2026-09-20 与工器通 /auth/login 语义对齐：账号免密直登）。

    兼容 identifier / phone / username 三种字段名（与工具库 routes/auth.js 同族），
    取第一个非空值作为标识，按 手机号 → 用户名(name) → 邮箱 顺序匹配。
    """
    identifier: Optional[str] = None
    phone: Optional[str] = None
    username: Optional[str] = None
    # 匹配顺序：username（登录账号）→ phone → email；name 仅中文展示，不作为登录标识。

class UserResponse(UserBase):
    id: int
    avatar: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    # 权限位数组（Phase 0 RBAC），供前端精确禁用按钮；由接口按当前用户 role 填充。
    permissions: List[str] = []
    
    model_config = ConfigDict(from_attributes=True)

class UserUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None

class UserPasswordUpdate(BaseModel):
    user_id: int
    current_password: str
    new_password: str

# Duty Schedule schemas
class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

# ==================== 机房 schemas ====================

class RoomBase(BaseModel):
    building: str           # GTC / 东停车楼 / 西停车楼
    floor: str
    name: str
    code: str               # 唯一编号
    room_type: str          # 设备机房 / 办公及储藏 / 弱电机房 / 卫生间
    shift: str = "morning"  # morning / evening / both
    is_active: bool = True

class RoomCreate(RoomBase):
    pass

class RoomUpdate(BaseModel):
    building: Optional[str] = None
    floor: Optional[str] = None
    name: Optional[str] = None
    room_type: Optional[str] = None
    shift: Optional[str] = None
    is_active: Optional[bool] = None

class RoomResponse(RoomBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class RoomBatchImport(BaseModel):
    rooms: List[RoomCreate]
