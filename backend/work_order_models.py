"""运维执行域 · 物理表模型（工单 / 审计事件 / 离线收据 / 备件镜像）。

数据纪律（红线，务必逐条守住）
------------------------------
- **同库新表**：与资产台账共用 app.db，但全部为**独立物理表**；
  绝不写入 `records` / `data_tables`，因此**天然不进 `_ALL_SQL`**，
  不可能污染资产总台账 total（AC-08 / R2/R3）。
- **C1**：`work_orders.asset_device_code` 是 TEXT 引用资产总台账 `device_code`，
  **不建 devices 外键**（台账含仅存在于 records 的设备，加 FK 会误拒）。
- **C2**：`work_orders.room_code` 引用核心 `rooms.code`，不新建区域表。
- **C6**：状态即日志 —— `work_orders.status` 是当前态，`work_order_events` 为
  **只增不改不删**的不可变审计日志（本模块不提供任何 UPDATE/DELETE 入口）。
- `version` 为乐观锁列：任何状态变更 +1，供离线 `wo_update` 冲突合并（AC-07）。

时间口径：与既有代码一致，统一写 UTC（`datetime.now(timezone.utc)`）；
前端按既有 `fmtIso` 约定补 `Z` 显示（见 Spec §11「时间早 8h」）。
"""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, Integer, JSON, String, Text,
)

from database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# =====================================================================
# 工单执行流
# =====================================================================

class WorkOrder(Base):
    """工单主表。

    状态枚举（无 draft 态）：
      pending_dispatch → assigned → in_progress → completed → pending_review → closed
      旁路：任意活跃态 → cancelled；cancelled/closed 经 reopen 动作回到 assigned|in_progress。
    """
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, unique=True, index=True, nullable=False)   # WO-YYYYMMDD-NNNN
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    type = Column(String, index=True, default="corrective")          # preventive/corrective/other
    failure_flag = Column(Boolean, default=False, index=True)         # 故障类标记（C4：MTBF 分子口径）
    status = Column(String, index=True, default="pending_dispatch", nullable=False)
    priority = Column(String, default="medium")                       # low/medium/high/urgent
    # C1：TEXT 引用 ledger.device_code（非 devices 外键）
    asset_device_code = Column(String, index=True, nullable=True)
    # C2：引用核心 rooms.code
    room_code = Column(String, index=True, nullable=True)
    subsystem_code = Column(String, default="")
    reporter_id = Column(Integer, index=True, nullable=False)
    assignee_id = Column(Integer, index=True, nullable=True)
    reviewer_id = Column(Integer, nullable=True)
    source = Column(String, default="web")                            # web/miniprogram/iot_alert/import
    alert_id = Column(Integer, nullable=True)                         # C5：告警映射 device_code，此处只存告警 id
    parent_id = Column(Integer, index=True, nullable=True)             # reopen 派生新单的来源
    due_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    cancelled_at = Column(DateTime, nullable=True)                    # 旁路时间戳（审计用）
    version = Column(Integer, default=1, nullable=False)              # 乐观锁
    meta = Column(JSON, default=dict)                                # SOP 引用等自由字段
    created_at = Column(DateTime, default=_utcnow, index=True)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)


class WorkOrderEvent(Base):
    """工单审计事件（**不可变**：只增，不提供 UPDATE / DELETE 入口，C6）。

    `actor_id = 0` 表示 system / iot 自动产生（契约约定）。
    `client_op_id` 记录离线来源，用于「重试不重复应用」的追溯（C7）。
    """
    __tablename__ = "work_order_events"

    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, index=True, nullable=False)
    event_type = Column(String, index=True, nullable=False)
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=True)
    actor_id = Column(Integer, default=0, nullable=False)
    payload = Column(JSON, default=dict)
    client_op_id = Column(String, index=True, nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)


class SyncReceipt(Base):
    """离线同步幂等收据：`client_op_id` 唯一，重试直接回放既有结果。

    只对 `accepted` 的操作落收据 —— conflict / error 不落，保证用户解决冲突后
    重试同一 op 能被真正重放（AC-07：409 由用户决定，不得自动覆盖）。
    """
    __tablename__ = "sync_receipts"

    client_op_id = Column(String, primary_key=True)
    result = Column(JSON, default=dict)      # {status, serverId?, serverVersion?, message?, kind?}
    server_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)


# =====================================================================
# 备件联邦 Phase A（单向只读镜像 + 桥接）
# =====================================================================

class SparePartCatalog(Base):
    """备件/工器具目录镜像（外部契约 tools-management → 本地只读镜像）。

    单向：外部导出 → 本表 upsert；本系统**不回写**外部（Phase B 才谈回写）。
    """
    __tablename__ = "spare_parts_catalog"

    part_code = Column(String, primary_key=True)
    name = Column(String, nullable=False, default="")
    spec = Column(String, nullable=True)
    unit = Column(String, nullable=True)
    category = Column(String, nullable=True)
    safety_flag = Column(Boolean, default=False)                       # 是否安全防护用品
    last_synced_at = Column(DateTime, nullable=True)


class SparePartInventory(Base):
    """备件库存镜像（单向只读；不进 `_ALL_SQL`）。"""
    __tablename__ = "spare_parts_inventory"

    id = Column(Integer, primary_key=True, index=True)
    part_code = Column(String, index=True, nullable=False)
    qty = Column(Float, default=0.0)
    location = Column(String, nullable=True)
    last_synced_at = Column(DateTime, nullable=True)


class WorkOrderSpareConsumption(Base):
    """工单 ←→ 备件耗用桥接表（记录"这单用了什么"，不改外部库存）。"""
    __tablename__ = "work_order_spare_consumptions"

    id = Column(Integer, primary_key=True, index=True)
    work_order_id = Column(Integer, index=True, nullable=False)
    part_code = Column(String, index=True, nullable=False)
    qty_planned = Column(Float, default=0.0)
    qty_actual = Column(Float, default=0.0)
    status = Column(String, default="planned")                         # planned / consumed / cancelled
    ref_id = Column(String, nullable=True)                             # 对账用外部单号
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
