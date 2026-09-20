"""运维执行域 · 请求/响应 Schema（严格对齐 OpenAPI 3.0.3 契约）。

契约即唯一依据：字段名、可空性、枚举取值一律以
`C:/Users/yan/.workbuddy/inspection-phase1-openapi.md` 为准。
本模块只做形状与取值校验，不含业务规则（业务规则在 service 层）。
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from work_order_state import PRIORITIES, REOPEN_TARGETS, SOURCES, TYPES


# ==================== 工单 · 请求 ====================

class WorkOrderCreate(BaseModel):
    """POST /ops/api/work-orders 请求体（契约 WorkOrderCreate）。"""
    title: str = Field(..., max_length=200)
    type: str
    description: Optional[str] = None
    failure_flag: bool = False
    priority: Optional[str] = "medium"
    asset_device_code: Optional[str] = None
    room_code: Optional[str] = None
    subsystem_code: Optional[str] = None
    reporter_id: Optional[int] = None          # 缺省 = 当前登录用户
    due_at: Optional[datetime] = None
    source: Optional[str] = "web"
    meta: Optional[Dict[str, Any]] = None

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("title 不能为空")
        return v

    @field_validator("type")
    @classmethod
    def _type_enum(cls, v: str) -> str:
        if v not in TYPES:
            raise ValueError(f"type 必须是 {'/'.join(TYPES)} 之一")
        return v

    @field_validator("priority")
    @classmethod
    def _priority_enum(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return "medium"
        if v not in PRIORITIES:
            raise ValueError(f"priority 必须是 {'/'.join(PRIORITIES)} 之一")
        return v

    @field_validator("source")
    @classmethod
    def _source_enum(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return "web"
        if v not in SOURCES:
            raise ValueError(f"source 必须是 {'/'.join(SOURCES)} 之一")
        return v


class DispatchRequest(BaseModel):
    assignee_id: int
    note: Optional[str] = None
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）


class StartRequest(BaseModel):
    note: Optional[str] = None
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）


class CompleteRequest(BaseModel):
    note: Optional[str] = None
    photo_urls: Optional[List[str]] = None
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）


class SubmitReviewRequest(BaseModel):
    note: Optional[str] = None
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）


class ReviewRequest(BaseModel):
    approved: bool
    note: Optional[str] = None
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）


class CancelRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）


class ReopenRequest(BaseModel):
    target_status: str
    note: Optional[str] = None
    version: Optional[int] = None   # 乐观锁基准版本（缺省 None = 不做版本校验，向后兼容）

    @field_validator("target_status")
    @classmethod
    def _target_enum(cls, v: str) -> str:
        if v not in REOPEN_TARGETS:
            raise ValueError(f"target_status 必须是 {'/'.join(REOPEN_TARGETS)} 之一")
        return v


# ==================== 工单 · 响应 ====================

class WorkOrder(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    title: str
    description: Optional[str] = None
    type: str
    failure_flag: bool = False
    status: str
    priority: str = "medium"
    asset_device_code: Optional[str] = None
    room_code: Optional[str] = None
    subsystem_code: Optional[str] = None
    reporter_id: int
    assignee_id: Optional[int] = None
    reviewer_id: Optional[int] = None
    source: str = "web"
    alert_id: Optional[int] = None
    parent_id: Optional[int] = None
    due_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    version: int = 1
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    meta: Optional[Dict[str, Any]] = None


class WorkOrderEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    work_order_id: int
    event_type: str
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    actor_id: int = 0
    payload: Optional[Dict[str, Any]] = None
    client_op_id: Optional[str] = None
    created_at: Optional[datetime] = None


class WorkOrderDetail(WorkOrder):
    events: List[WorkOrderEvent] = []


class WorkOrderPage(BaseModel):
    items: List[WorkOrder] = []
    total: int = 0
    page: int = 1
    page_size: int = 20
    has_more: bool = False


# ==================== 离线同步 ====================

class PendingOp(BaseModel):
    """客户端离线队列条目（契约 PendingOp）。"""
    model_config = ConfigDict(populate_by_name=True, extra="allow")

    id: str
    kind: str                                   # wo_create / wo_update / wo_action / photo
    entityId: Optional[str] = None
    version: Optional[int] = None
    action: Optional[str] = None
    payload: Dict[str, Any] = {}
    createdAt: Optional[int] = None
    tries: Optional[int] = 0
    lastError: Optional[str] = None
    conflictFrom: Optional[str] = None
    localRefs: Optional[Dict[str, Any]] = None
    status: Optional[str] = None

    @field_validator("kind")
    @classmethod
    def _kind_enum(cls, v: str) -> str:
        allowed = ("wo_create", "wo_update", "wo_action", "photo")
        if v not in allowed:
            raise ValueError(f"kind 必须是 {'/'.join(allowed)} 之一")
        return v


class SyncRequest(BaseModel):
    ops: List[PendingOp]


class SyncResult(BaseModel):
    clientOpId: str
    status: str                                  # accepted / conflict / error
    serverId: Optional[int] = None
    serverVersion: Optional[int] = None
    message: Optional[str] = None


class SyncResponse(BaseModel):
    results: List[SyncResult] = []


# ==================== 附件 ====================

class AttachmentUploadResponse(BaseModel):
    url: str
    filename: str


# ==================== 备件联邦（外部契约） ====================

class Part(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    part_code: str
    name: Optional[str] = None
    spec: Optional[str] = None
    unit: Optional[str] = None
    category: Optional[str] = None
    safety_flag: bool = False


class InventoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    part_code: str
    qty: float = 0.0
    location: Optional[str] = None
    last_synced_at: Optional[datetime] = None


class InventoryConsumeResult(BaseModel):
    part_code: str
    consumed: float
    balance: float
    ref: Optional[str] = None
