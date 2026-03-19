from pydantic import BaseModel
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
    
    class Config:
        from_attributes = True

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
class DutyScheduleBase(BaseModel):
    staff_id: int
    staff_name: str
    department: str
    position: str
    shift_type: str
    date: str
    start_time: str
    end_time: str
    status: str = "scheduled"

class DutyScheduleCreate(DutyScheduleBase):
    pass

class DutyScheduleResponse(DutyScheduleBase):
    id: int
    created_at: datetime
    
    class Config:
        from_attributes = True

class DutyScheduleBatch(BaseModel):
    schedules: List[DutyScheduleCreate]

# Shift Task schemas
class ShiftTaskBase(BaseModel):
    title: str
    content: Optional[str] = None
    shift: str
    date: str
    department: Optional[str] = None
    priority: str = "normal"
    notes: Optional[str] = None

class ShiftTaskCreate(ShiftTaskBase):
    pass

class ShiftTaskUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    completed: Optional[bool] = None
    priority: Optional[str] = None
    notes: Optional[str] = None
    images: Optional[str] = None  # JSON字符串

class ShiftHandoverRequest(BaseModel):
    """交班请求：将任务迁移到下一班次"""
    task_id: int
    next_shift: str   # 'morning' | 'evening'
    next_date: str    # YYYY-MM-DD

class ShiftTaskResponse(ShiftTaskBase):
    id: int
    completed: bool
    completed_at: Optional[datetime] = None
    completed_by: Optional[str] = None
    handover_count: int
    images: Optional[str] = None  # JSON字符串，存储图片路径列表
    created_at: datetime
    
    class Config:
        from_attributes = True

# Token schema
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

    class Config:
        from_attributes = True

class RoomBatchImport(BaseModel):
    rooms: List[RoomCreate]

# ==================== 巡查规则 schemas ====================

class InspectionRuleBase(BaseModel):
    name: str
    high_freq_days: int = 4    # 高频：每 N 天一轮
    low_freq_times: int = 2    # 低频：每月 M 次
    is_active: bool = True

class InspectionRuleCreate(InspectionRuleBase):
    pass

class InspectionRuleUpdate(BaseModel):
    name: Optional[str] = None
    high_freq_days: Optional[int] = None
    low_freq_times: Optional[int] = None
    is_active: Optional[bool] = None

class InspectionRuleResponse(InspectionRuleBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# ==================== 巡查计划 schemas ====================

class InspectionPlanBase(BaseModel):
    name: str
    year: int
    month: int
    data: str  # JSON字符串，存储完整的巡查计划数据

class InspectionPlanCreate(InspectionPlanBase):
    pass

class InspectionPlanUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[str] = None

class InspectionPlanResponse(InspectionPlanBase):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class GeneratePlanRequest(BaseModel):
    year: int
    month: int
    rule_id: Optional[int] = None   # 不填则用当前生效规则
    overwrite: bool = False         # 是否覆盖已有计划

