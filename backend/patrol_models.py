"""巡查打卡域 · 物理表模型（线路 / 线路节点 / 打卡记录）。

数据纪律（红线，务必逐条守住）
------------------------------
- **同库新表**：与资产台账、工单共用 app.db，但全部为**独立物理表**；
  绝不写入 `records` / `data_tables`，因此**天然不进 `_ALL_SQL`**，
  不可能污染资产总台账 total（沿用工单域 AC-08 / R2/R3 的同一纪律）。
- **不改 `work_orders` 表结构**：工单挂哪条线路存 `work_orders.meta` 的
  `route_id` 键（JSON 自由字段），**无需 ALTER TABLE、无需数据迁移**。
- `inspection_route_nodes.room_code` 引用核心 `rooms.code`，**不建外键**
  （同工单域 C2：rooms 为权威镜像，但历史线路节点允许指向已清理的房间，
  建 FK 会让删房间失败）。
- **无打卡顺序约束**：打卡只认 `node_id`，**不存在「上节点必须是下节点」**，
  用户任选节点先打都行（产品明确要求「不区分先后顺序」）。
- `inspection_checkins` 记「谁在何时到了哪个节点、有无异常」，**只增不改**
  （与 `work_order_events` 同属审计层，本模块不提供 UPDATE/DELETE 入口）。
- 幂等靠唯一索引 `(work_order_id, node_id)`：同一工单同一节点只允许一条打卡，
  重复提交由 DB 兜底返 409（应用层先查、后写；DB 是最后防线）。

时间口径：与既有代码一致，统一写 UTC（`datetime.now(timezone.utc)`）；
前端按既有 `fmtIso` 约定补 `Z` 显示（见 Spec §11「时间早 8h」）。
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, String, Text, UniqueConstraint,
)

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# =====================================================================
# 巡查线路
# =====================================================================

class InspectionRoute(Base):
    """巡查线路（一条线 = 一串待巡节点，供工单挂载后逐点打卡）。"""
    __tablename__ = "inspection_routes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)   # RT-YYYYMMDD-NNN
    name = Column(String, nullable=False)
    description = Column(Text, default="")
    status = Column(String, index=True, default="active")            # active / archived
    owner_id = Column(Integer, index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


# =====================================================================
# 线路节点
# =====================================================================

class InspectionRouteNode(Base):
    """线路节点。

    `seq` **仅用于列表展示排序，不限制打卡顺序** —— 这是产品的明确要求，
    不要在打卡逻辑里拿 seq 做前后置校验。
    """
    __tablename__ = "inspection_route_nodes"

    id = Column(Integer, primary_key=True, index=True)
    route_id = Column(Integer, index=True, nullable=False)
    seq = Column(Integer, default=0)                                 # 展示排序号（非打卡顺序）
    node_type = Column(String, default="room")                       # room / area
    room_code = Column(String, index=True, nullable=True)            # node_type=room 时必填
    area_code = Column(String, index=True, nullable=True)            # node_type=area 时必填
    qr_payload = Column(String, nullable=True)                       # 扫码加入时的原始二维码内容
    snapshot_name = Column(String, default="")                       # 冗余节点名，列表免联表
    require_checkin = Column(Boolean, default=True)                  # 是否必须打卡
    created_at = Column(DateTime, default=_utcnow)


# =====================================================================
# 打卡记录（只增不改 · 审计层）
# =====================================================================

class InspectionCheckin(Base):
    """打卡记录：某工单在某节点被某人在某时刻打了卡。

    幂等：`(work_order_id, node_id)` 唯一索引 —— 同一工单同一节点只允许一条。
    `route_id` 冗余存一份，便于「按线路维度统计打卡率」时不必回工单解析 meta。
    定位只记录、不拦截（二期再开强校验），故 lat/lng 允许为空。
    """
    __tablename__ = "inspection_checkins"
    __table_args__ = (
        UniqueConstraint("work_order_id", "node_id", name="uq_checkin_wo_node"),
    )

    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, index=True, nullable=False)
    route_id = Column(Integer, index=True, nullable=True)            # 冗余
    node_id = Column(Integer, index=True, nullable=False)
    operator_id = Column(Integer, index=True, nullable=False)
    checked_at = Column(DateTime, default=_utcnow, index=True)
    lat = Column(Float, nullable=True)                               # 打卡定位（只记录不拦截）
    lng = Column(Float, nullable=True)
    remark = Column(Text, default="")
    abnormal = Column(Boolean, default=False, index=True)            # 异常时 remark 必填
    created_at = Column(DateTime, default=_utcnow)
