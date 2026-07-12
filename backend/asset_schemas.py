"""分系统资料管理 · Pydantic Schemas"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict


# ==================== 子系统 ====================

class SubsystemBase(BaseModel):
    code: str
    name: str
    icon: Optional[str] = ""
    sort_order: int = 0
    is_active: bool = True

class SubsystemCreate(SubsystemBase):
    pass

class SubsystemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

class SubsystemResponse(SubsystemBase):
    id: int
    created_at: Any
    model_config = ConfigDict(from_attributes=True)


# ==================== 设备台账 ====================

class DeviceBase(BaseModel):
    device_code: str
    name: str
    subsystem_id: Optional[int] = None
    room_id: Optional[int] = None
    building: str = ""
    floor: str = ""
    location_desc: str = ""
    parent_device_id: Optional[int] = None
    is_active: bool = True

class DeviceCreate(DeviceBase):
    pass

class DeviceUpdate(BaseModel):
    device_code: Optional[str] = None
    name: Optional[str] = None
    subsystem_id: Optional[int] = None
    room_id: Optional[int] = None
    building: Optional[str] = None
    floor: Optional[str] = None
    location_desc: Optional[str] = None
    parent_device_id: Optional[int] = None
    is_active: Optional[bool] = None

class DeviceResponse(DeviceBase):
    id: int
    created_at: Any
    updated_at: Any
    subsystem_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ==================== 资料表 ====================

class DataTableBase(BaseModel):
    subsystem_id: int
    code: str
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True

class DataTableCreate(DataTableBase):
    pass

class DataTableUpdate(BaseModel):
    subsystem_id: Optional[int] = None
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None

class DataTableResponse(DataTableBase):
    id: int
    created_at: Any
    updated_at: Any
    subsystem_name: Optional[str] = None
    field_count: int = 0
    model_config = ConfigDict(from_attributes=True)


# ==================== 字段定义 ====================

class FieldDefBase(BaseModel):
    table_id: int
    key: str
    label: str
    type: str = "text"          # text/number/date/select/device_ref
    options: List[str] = []
    is_required: bool = False
    is_relation_key: bool = False
    sort_order: int = 0

class FieldDefCreate(FieldDefBase):
    pass

class FieldDefUpdate(BaseModel):
    table_id: Optional[int] = None
    key: Optional[str] = None
    label: Optional[str] = None
    type: Optional[str] = None
    options: Optional[List[str]] = None
    is_required: Optional[bool] = None
    is_relation_key: Optional[bool] = None
    sort_order: Optional[int] = None

class FieldDefResponse(FieldDefBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


# ==================== 资料记录 ====================

class RecordBase(BaseModel):
    table_id: Optional[int] = None      # 由 URL 路径提供，body 中可选
    device_code: Optional[str] = None   # 可选；缺省时从关联键字段取值
    data: Dict[str, Any] = {}
    created_by: str = ""

class RecordCreate(RecordBase):
    pass

class RecordUpdate(BaseModel):
    device_code: Optional[str] = None
    data: Optional[Dict[str, Any]] = None

class RecordResponse(BaseModel):
    id: int
    table_id: int
    device_code: str
    data: Dict[str, Any]
    created_by: str
    created_at: Any
    updated_at: Any
    # 便于前端展示
    device_name: Optional[str] = None
    table_name: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


# ==================== 设备关联 ====================

class DeviceRelationBase(BaseModel):
    from_code: str
    to_code: str
    relation_type: str = "关联"
    subsystem_id: Optional[int] = None
    meta: Dict[str, Any] = {}

class DeviceRelationCreate(DeviceRelationBase):
    pass

class DeviceRelationUpdate(BaseModel):
    from_code: Optional[str] = None
    to_code: Optional[str] = None
    relation_type: Optional[str] = None
    subsystem_id: Optional[int] = None
    meta: Optional[Dict[str, Any]] = None

class DeviceRelationResponse(DeviceRelationBase):
    id: int
    created_at: Any
    model_config = ConfigDict(from_attributes=True)


# ==================== 搜索结果 ====================

class SearchResult(BaseModel):
    target: Optional[DeviceResponse] = None
    found: bool = False
    nodes: List[Dict[str, Any]] = []       # {device_code,name,subsystem_code,subsystem_name,depth}
    edges: List[Dict[str, Any]] = []       # {from,to,type,subsystem_code}
    groups: List[Dict[str, Any]] = []      # [{subsystem_code,subsystem_name,tables:[{table_id,table_code,table_name,records:[...]}]}]
    total_records: int = 0


# ==================== 批量建记录（Excel 导入后端落库用） ====================

class BulkRecordItem(BaseModel):
    device_code: Optional[str] = None   # 可选；缺省时从关联键字段取值
    data: Dict[str, Any] = {}

class BulkRecordCreate(BaseModel):
    records: List[BulkRecordItem] = []
