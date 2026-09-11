from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime

# User schemas
class UserBase(BaseModel):
    email: str
    name: str
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserLogin(BaseModel):
    phone: str
    password: str

class UserResponse(UserBase):
    id: int
    avatar: Optional[str] = None
    role: str
    is_active: bool
    created_at: datetime
    
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
    room_type: str          # 高频 / 低频
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
