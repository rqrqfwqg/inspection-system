"""巡查打卡域 · 请求/响应 Schema。

声明式校验红线（沿用工单域教训，见 MEMORY.md §13）
------------------------------------------------
FastAPI 对**未声明的查询参数静默忽略**、对**裸 `str` 静默当合法值查库**，
会造成「接口 200 但筛选不生效或恒空」，排查成本极高。故本模块：

- 枚举一律用 `Literal`，数值一律 `Query(ge=, le=)`，日期用 `date`；
- `q` 关键词超长按 **100 字符截断、不报错**（与工单域口径一致），
  因此 schema **不写 `maxLength`**（契约口径必须严格等于实现）。

另：`meta.route_id` 的取用只认 int，**不提供 status=draft**（工单域 7 态无 draft）。
"""
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from work_order_state import PRIORITIES


# ==================== 线路 · 请求 ====================

class RouteNodeIn(BaseModel):
    """单个节点（新建/全量编辑线路时随线路一次提交）。"""
    seq: int = 0
    node_type: Literal["room", "area"] = "room"
    room_code: Optional[str] = None
    area_code: Optional[str] = None
    qr_payload: Optional[str] = None
    snapshot_name: str = ""
    require_checkin: bool = True

    @field_validator("room_code")
    @classmethod
    def _room(cls, v: Optional[str]) -> Optional[str]:
        return (v or "").strip() or None

    @field_validator("area_code")
    @classmethod
    def _area(cls, v: Optional[str]) -> Optional[str]:
        return (v or "").strip() or None


class RouteCreate(BaseModel):
    """POST /ops/api/routes"""
    name: str = Field(..., max_length=200)
    description: Optional[str] = None
    status: Literal["active", "archived"] = "active"
    owner_id: Optional[int] = None          # 缺省 = 当前登录用户
    nodes: List[RouteNodeIn] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("线路名不能为空")
        return v


class RouteUpdate(BaseModel):
    """PUT /ops/api/routes/{id} —— 节点**全量提交**（前端一次给整份清单）。"""
    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    status: Optional[Literal["active", "archived"]] = None
    nodes: Optional[List[RouteNodeIn]] = None


class RouteNodeAppend(BaseModel):
    """POST /ops/api/routes/{id}/nodes —— 追加节点（扫码加节点走这里）。"""
    node_type: Literal["room", "area"] = "room"
    room_code: Optional[str] = None
    area_code: Optional[str] = None
    qr_payload: Optional[str] = None
    snapshot_name: str = ""
    require_checkin: bool = True
    seq: Optional[int] = None

    @field_validator("room_code")
    @classmethod
    def _room(cls, v: Optional[str]) -> Optional[str]:
        return (v or "").strip() or None

    @field_validator("area_code")
    @classmethod
    def _area(cls, v: Optional[str]) -> Optional[str]:
        return (v or "").strip() or None


# ==================== 工单编辑 / 删除 ====================

class WorkOrderUpdate(BaseModel):
    """PUT /ops/api/work-orders/{id} —— 编辑（带 version 乐观锁，与动作端点同语义）。"""
    title: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    type: Optional[Literal["preventive", "corrective", "other"]] = None
    priority: Optional[str] = None
    asset_device_code: Optional[str] = None
    room_code: Optional[str] = None
    assignee_id: Optional[int] = None
    due_at: Optional[datetime] = None
    meta: Optional[Dict[str, Any]] = None
    version: Optional[int] = None      # 缺省 None = 不校验版本（向后兼容）

    @field_validator("priority")
    @classmethod
    def _prio(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if v not in PRIORITIES:
            raise ValueError(f"priority 必须是 {'/'.join(PRIORITIES)} 之一")
        return v

    @field_validator("title")
    @classmethod
    def _title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = (v or "").strip()
        if not v:
            raise ValueError("title 不能为空")
        return v


# ==================== 打卡 · 请求 ====================

class CheckinCreate(BaseModel):
    """POST /ops/api/work-orders/{id}/checkin

    `abnormal=True` 时 `remark` 必填（服务端二次校验并返 400）。
    lat/lng 只记录不拦截，允许为空。
    """
    node_id: int
    remark: Optional[str] = None
    abnormal: bool = False
    lat: Optional[float] = None
    lng: Optional[float] = None

    @field_validator("lat")
    @classmethod
    def _lat_range(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return None
        if not (-90.0 <= float(v) <= 90.0):
            raise ValueError("lat 超出范围")
        return float(v)

    @field_validator("lng")
    @classmethod
    def _lng_range(cls, v: Optional[float]) -> Optional[float]:
        if v is None:
            return None
        if not (-180.0 <= float(v) <= 180.0):
            raise ValueError("lng 超出范围")
        return float(v)


# ==================== 响应 ====================

class RouteNodeOut(BaseModel):
    """节点完整视图（含 id）。

    🔴 `RouteDetail.nodes` 必须用**本模型**而非 `RouteNodeIn`：`RouteNodeIn` 是请求模型、
    没有 `id` 字段，前端拿到就没法用于后续打卡（打卡 body 要 `node_id`）。
    """
    id: int
    seq: int = 0
    node_type: str = "room"
    room_code: Optional[str] = None
    area_code: Optional[str] = None
    qr_payload: Optional[str] = None
    snapshot_name: str = ""
    require_checkin: bool = True


class RouteOut(BaseModel):
    """线路列表项（含节点数，避免前端再拉一次详情）。"""
    id: int
    code: str
    name: str
    description: str = ""
    status: str = "active"
    owner_id: int
    node_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class RouteDetail(RouteOut):
    """线路详情（含节点清单，节点带 id 供打卡使用）。"""
    nodes: List[RouteNodeOut] = Field(default_factory=list)


class CheckinOut(BaseModel):
    id: int
    work_order_id: int
    route_id: Optional[int] = None
    node_id: int
    operator_id: int
    checked_at: Optional[datetime] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    remark: Optional[str] = None
    abnormal: bool = False


class WoNodeOut(BaseModel):
    """工单详情页用：线路节点 + 该节点在本工单下的打卡状态。

    判定口径见 patrol_service.wo_nodes_with_checkin：
      done   = 该 node_id 在 inspection_checkins 有记录（绿）
      pending= 无记录（灰）；若工单已逾期，前端再按 due_at 打「已逾期」红标。
    """
    id: int
    route_id: int
    seq: int = 0
    node_type: str = "room"
    room_code: Optional[str] = None
    area_code: Optional[str] = None
    qr_payload: Optional[str] = None
    snapshot_name: str = ""
    require_checkin: bool = True
    checkin_status: str = "pending"        # pending / done
    checked_at: Optional[datetime] = None
    operator_id: Optional[int] = None
    remark: Optional[str] = None
    abnormal: bool = False


class CheckinResult(BaseModel):
    """打卡结果：带回最新进度，前端不必再拉一次详情。"""
    ok: bool = True
    checkin: Optional[CheckinOut] = None
    node_total: int = 0
    node_done: int = 0
    all_done: bool = False
    message: Optional[str] = None


class PatrolStats(BaseModel):
    """GET /ops/api/stats/patrol —— 首页「生产数据」三张卡。"""
    wo_doing: int = 0                    # 进行中：in_progress + assigned + pending_dispatch
    wo_doing_doing: int = 0             # 仅 in_progress（细分明细，调试用）
    wo_pending: int = 0
    wo_overdue: int = 0                 # 逾期只计数，不改 status
    today_checkin_rate: float = 100.0   # 今日打卡率 %；无到期节点 = 100%
    today_checked_nodes: int = 0
    today_due_nodes: int = 0
    rooms_inventoried: int = 0          # 已盘点机房数（最新状态口径）
    rooms_total: int = 0
