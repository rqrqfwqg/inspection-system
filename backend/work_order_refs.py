"""运维执行域 · 引用完整性校验（C1 设备 / C2 房间）。

为什么单独成模块
----------------
「工单引用的设备编号是否真实存在」是**跨资源**的口径问题，两个地方都要用
（建单、离线同步建单），且必须**只有一个判据来源**：

- **C1**：`asset_device_code` 是 TEXT 引用资产总台账 `device_code`。
  判据复用 ledger 服务的 `_load_all`（`/ops/api/assets/asset-ledger` 同一份行集合、
  同一 60s 缓存）——**绝不**在本层重算口径、**绝不**建 devices 外键（C3/R1）。
- **C2**：`room_code` 必须命中核心 `rooms.code`，不新建区域表。
"""
from typing import Optional, Set

from sqlalchemy.orm import Session

from database import Room
from ops_errors import unprocessable

# 台账口径唯一来源（只读复用；本模块不写入 ledger）
from asset_ledger_routes import _load_all as _ledger_load_all


def ledger_device_codes(db: Session) -> Set[str]:
    """资产总台账 device_code 全集（复用 ledger 服务行集合与缓存）。"""
    return {r["device_code"] for r in _ledger_load_all(db) if r.get("device_code")}


def validate_device_code(db: Session, code: Optional[str]) -> Optional[str]:
    """C1 + AC-02：`asset_device_code` 不在台账 → 422，且不建单。空值原样返回 None。"""
    c = (code or "").strip()
    if not c:
        return None
    if c not in ledger_device_codes(db):
        raise unprocessable(
            f"asset_device_code「{c}」不在资产总台账（ledger）中，已拒绝建单")
    return c


def validate_room_code(db: Session, code: Optional[str]) -> Optional[str]:
    """C2：房间号必须命中核心 `rooms`，避免自由文本把区域口径打散。空值返回 None。"""
    c = (code or "").strip()
    if not c:
        return None
    if not db.query(Room.id).filter(Room.code == c).first():
        raise unprocessable(f"room_code「{c}」不在核心 rooms 中，已拒绝建单")
    return c
