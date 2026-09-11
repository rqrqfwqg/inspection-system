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
    record_count: int = 0      # 该表现存记录行数（列表/卡片统计用，与 field_count 同为只读聚合）
    relation_key_label: Optional[str] = None  # is_relation_key 字段的中文名（记录归属设备用，展示用）
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


# ---------- 记录跨表转移（字段映射） ----------

class TransferMappingItem(BaseModel):
    source_key: str
    source_label: str
    source_type: Optional[str] = None
    target_key: Optional[str] = None
    target_label: Optional[str] = None
    confidence: str = "none"        # exact_key|exact_label|normalized|contains|type_only|none
    score: int = 0
    reason: str = ""

class TransferMappingResponse(BaseModel):
    source_table: Dict[str, Any]
    target_table: Dict[str, Any]
    matches: List[TransferMappingItem] = []
    # 源表有、但自动匹配没落到目标字段的（前端可手工指定或按策略处理）
    unmapped_sources: List[Dict[str, Any]] = []
    # 目标表有、但源表没有对应字段的（必填的需重点提示）
    unfilled_targets: List[Dict[str, Any]] = []
    # 目标表中可接收"未映射内容"的长文本字段（备注类）
    remark_candidates: List[Dict[str, Any]] = []

class RecordTransferRequest(BaseModel):
    target_table_id: int
    record_ids: List[int]
    mapping: Dict[str, Optional[str]] = {}      # {源字段key: 目标字段key|null}
    unmapped_policy: str = "extra"              # drop|remark|extra
    remark_target_key: Optional[str] = None     # policy=remark 时写入的目标字段
    mode: str = "move"                          # move|copy
    on_conflict: str = "skip"                   # skip|update|duplicate（目标表已存在同编号时）
    dry_run: bool = False                       # 只算不写，用于前端预览


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


# ==================== 关联类型字典（P1：供配电/网络结构化） ====================

class RelationTypeResponse(BaseModel):
    code: str
    label: str
    kind: str = "other"
    direction: str = "none"
    description: str = ""
    sort_order: int = 0
    is_active: bool = True
    model_config = ConfigDict(from_attributes=True)


# ==================== 搜索结果 ====================

class SearchResult(BaseModel):
    target: Optional[DeviceResponse] = None
    found: bool = False
    nodes: List[Dict[str, Any]] = []       # {device_code,name,subsystem_code,subsystem_name,depth}
    edges: List[Dict[str, Any]] = []       # {from,to,type,subsystem_code}
    groups: List[Dict[str, Any]] = []      # [{subsystem_code,subsystem_name,tables:[{table_id,table_code,table_name,records:[...]}]}]
    total_records: int = 0
    # ===== 扩展聚合（可视化设计 C.5）：任一编号 → canonical 后聚合 =====
    fixed_asset: Optional[Dict[str, Any]] = None     # 固定资产财务块
    archive: Optional[Dict[str, Any]] = None         # 设备档案块
    accessories: List[Dict[str, Any]] = []            # 配件列表
    room: Optional[Dict[str, Any]] = None            # 所属机房 {room_code,room_name,building,floor}
    problems: List[Dict[str, Any]] = []              # BA 问题列表
    aliases: List[Dict[str, Any]] = []               # 编号别名溯源
    # ===== 设备数据面板（2026-09-10）：未登记 devices 的真实台账设备也能完整展示 =====
    profile: Optional[Dict[str, Any]] = None          # 设备画像（devices→档案→固定资产→records 逐级兜底）
    power_chain: Optional[Dict[str, Any]] = None      # 供电/冷源链路 {start_code,upstream,downstream,edges}


# ==================== 批量建记录（Excel 导入后端落库用） ====================

class BulkRecordItem(BaseModel):
    device_code: Optional[str] = None   # 可选；缺省时从关联键字段取值
    data: Dict[str, Any] = {}

class BulkRecordCreate(BaseModel):
    records: List[BulkRecordItem] = []


# ==================== 扫码盘点 · 房间 ↔ 设备（一对多） ====================

class RoomDeviceBind(BaseModel):
    """扫码把设备绑定到房间。

    move=True：若该设备已归属其他房间，自动改挂到本房间（现场纠错用）。
    落点 = device_relations 的「所在机房」边 + devices.room_id/building/floor 回填。
    """
    device_code: str
    move: bool = False


# ==================== 设备现场照片（扫码补录 P0） ====================

class DevicePhotoResponse(BaseModel):
    id: int
    device_code: str
    url: str
    note: str = ""
    created_by: str = ""
    created_at: Any = None
    model_config = ConfigDict(from_attributes=True)
