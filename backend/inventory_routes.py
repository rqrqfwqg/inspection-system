"""盘点重做 · 4 态状态机 + 差异检测 + 盘点报告（`/inventory/*`）。

为什么单独成模块
----------------
`asset_routes.py` 已 200KB+，盘点重做是**新增能力**而非对既有端点的修补，
塞进去会让 diff 难以审阅、也容易与资产域核心逻辑（红线：不得改资产核心）纠缠。
故独立成 `inventory_routes.py`，只**只读复用** `asset_routes` 内部工具函数
（`_room_bound_codes` / `_resolve_inventory_device` / `_get_room_or_404` / `_room_brief`），
保证**设备口径与既有设备清单完全同源** —— 这是盘点正确性的地基。

状态机（4 态）
--------------
    pending ──start──> doing ──complete(扫够)──> completed
                          │                            （终态）
                          └──complete(扫不够+说明)──> abnormal（终态）
    completed / abnormal 均可再次 start 重新盘（覆盖，幂等语义）

关键规则
--------
1. **扫不够必须说明**：`scanned_count < 应扫数` 时若不传 `abnormal_reason` → 400。
   杜绝「扫一半也提交成已完成」。
2. **差异只统计不改台账**：本模块**不改任何设备归属**。扫到非本房间设备时
   由 `/rooms/{code}/devices`（既有端点，409 冲突）处理改挂 —— 用户已确认
   「确认后改挂」，但那个动作发生在**绑定端点**，不在盘点链路上，保持职责单一。
3. **应扫数以开单瞬间为准**：`expected_count` 存在 `device_count` 之外的语义 ——
   开单时快照当时的应扫数，避免扫的过程中台账变动导致进度跳变。
4. 时间统一 UTC（与既有代码一致）。
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

import asset_routes as AR
from database import RoomInventoryRecord, User, get_db
from dependencies import get_current_user

router = APIRouter(tags=["inventory"])

_login = Depends(get_current_user)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ==================== 请求 Schema ====================

class InventoryStart(BaseModel):
    """开单：把房间推进到 doing。"""
    operator: str = ""
    source: str = "miniprogram"
    remark: str = ""


class InventoryScan(BaseModel):
    """记录一次扫码（累加 scanned_count）。"""
    operator: str = ""
    remark: str = ""


class InventoryCompleteEx(BaseModel):
    """提交盘点结果。"""
    operator: str = ""
    source: str = "miniprogram"
    remark: str = ""
    #: 扫不够时的异常说明；传 true 表示提交异常终态
    abnormal_reason: str = ""


# ==================== 内部工具 ====================

def _get_or_create_rec(db: Session, room_code: str) -> RoomInventoryRecord:
    rec = (db.query(RoomInventoryRecord)
           .filter(RoomInventoryRecord.room_code == room_code).first())
    if rec is None:
        rec = RoomInventoryRecord(room_code=room_code, created_at=_utcnow())
        db.add(rec)
        db.flush()
    return rec


def _expected_count(db: Session, room) -> int:
    """应扫数 = 该房间当前绑定设备数（与设备清单同源口径）。"""
    return len(AR._room_bound_codes(db, room))


def _rec_out(rec: RoomInventoryRecord, expected: int) -> Dict[str, Any]:
    """盘点记录 → 前端展示块。"""
    if rec is None:
        return {
            "inspected": False, "status": "pending", "device_count": 0,
            "scanned_count": 0, "expected_count": expected, "diff_count": 0,
            "abnormal": False, "abnormal_reason": "", "empty_confirmed": False,
            "operator": "", "remark": "", "source": "",
            "completed_at": None, "started_at": None,
        }
    scanned = int(rec.scanned_count or 0)
    return {
        "inspected": (rec.status or "") in ("completed", "abnormal"),
        "status": rec.status or "pending",
        "device_count": int(rec.device_count or 0),
        "scanned_count": scanned,
        "expected_count": expected,
        "diff_count": max(0, expected - scanned) if scanned else 0,
        "abnormal": bool(rec.abnormal),
        "abnormal_reason": rec.abnormal_reason or "",
        "empty_confirmed": bool(rec.empty_confirmed),
        "operator": rec.operator or "",
        "remark": rec.remark or "",
        "source": rec.source or "",
        "completed_at": rec.completed_at.isoformat() if rec.completed_at else None,
        "started_at": rec.started_at.isoformat() if rec.started_at else None,
    }


# ==================== 端点 ====================

@router.post("/rooms/{room_code}/inventory/start",
             summary="盘点开单（→ doing），应扫数开单瞬间快照")
def start_inventory(room_code: str, data: InventoryStart,
                    db: Session = Depends(get_db), _: User = _login):
    room = AR._get_room_or_404(db, room_code)
    expected = _expected_count(db, room)
    rec = _get_or_create_rec(db, room.code)
    now = _utcnow()
    rec.status = "doing"
    rec.started_at = now
    rec.scanned_count = 0
    rec.diff_count = 0
    rec.abnormal = False
    rec.abnormal_reason = ""
    rec.operator = (data.operator or rec.operator or "")[:64]
    rec.source = (data.source or "miniprogram")[:32]
    if data.remark:
        rec.remark = data.remark[:500]
    rec.updated_at = now
    db.commit()
    db.refresh(rec)
    return {"success": True, "room": AR._room_brief(room),
            "expected_count": expected, "inspected": _rec_out(rec, expected)}


@router.post("/rooms/{room_code}/inventory/scan",
             summary="记录一次扫码（累加 scanned_count）")
def scan_inventory(room_code: str, data: InventoryScan,
                   db: Session = Depends(get_db), _: User = _login):
    room = AR._get_room_or_404(db, room_code)
    expected = _expected_count(db, room)
    rec = _get_or_create_rec(db, room.code)
    if (rec.status or "") in ("completed", "abnormal"):
        # 已终态：不允许再累加（要继续盘请先 start 重开）
        return {"success": False, "message": "该房间已提交，如需重盘请重新开单",
                "expected_count": expected, "inspected": _rec_out(rec, expected)}
    rec.status = "doing"
    if not rec.started_at:
        rec.started_at = _utcnow()
    rec.scanned_count = int(rec.scanned_count or 0) + 1
    if data.operator:
        rec.operator = data.operator[:64]
    rec.updated_at = _utcnow()
    db.commit()
    db.refresh(rec)
    return {"success": True, "expected_count": expected,
            "inspected": _rec_out(rec, expected)}


@router.post("/rooms/{room_code}/inventory/submit",
             summary="提交盘点（扫够→completed / 扫不够必须填说明→abnormal）")
def submit_inventory(room_code: str, data: InventoryCompleteEx,
                     db: Session = Depends(get_db), _: User = _login):
    room = AR._get_room_or_404(db, room_code)
    expected = _expected_count(db, room)
    rec = _get_or_create_rec(db, room.code)
    scanned = int(rec.scanned_count or 0)
    reason = (data.abnormal_reason or "").strip()

    # 空房确认：应扫 0 时直接算完成（与既有 empty_confirmed 语义一致）
    if expected == 0:
        rec.status = "completed"
        rec.abnormal = False
        rec.abnormal_reason = ""
        rec.diff_count = 0
    else:
        if scanned >= expected:
            rec.status = "completed"
            rec.abnormal = False
            rec.abnormal_reason = ""
            rec.diff_count = 0
        else:
            # 扫不够 —— 必须填异常说明，否则 400（杜绝「扫一半也提交成已完成」）
            if not reason:
                return {"success": False,
                        "message": f"已扫 {scanned}/{expected}，数量不足，须填写异常说明",
                        "need_reason": True,
                        "expected_count": expected, "inspected": _rec_out(rec, expected)}
            rec.status = "abnormal"
            rec.abnormal = True
            rec.abnormal_reason = reason[:500]
            rec.diff_count = max(0, expected - scanned)

    now = _utcnow()
    rec.device_count = expected
    rec.empty_confirmed = (expected == 0)
    rec.operator = (data.operator or rec.operator or "")[:64]
    rec.source = (data.source or "miniprogram")[:32]
    if data.remark:
        rec.remark = data.remark[:500]
    rec.completed_at = now
    rec.updated_at = now
    db.commit()
    db.refresh(rec)
    return {"success": True, "room": AR._room_brief(room),
            "expected_count": expected, "inspected": _rec_out(rec, expected)}


@router.get("/rooms/{room_code}/inventory",
            summary="某房间盘点详情（4 态 + 进度）")
def inventory_detail(room_code: str, db: Session = Depends(get_db), _: User = _login):
    room = AR._get_room_or_404(db, room_code)
    expected = _expected_count(db, room)
    rec = (db.query(RoomInventoryRecord)
           .filter(RoomInventoryRecord.room_code == room.code).first())
    return {"room": AR._room_brief(room),
            "inspected": _rec_out(rec, expected)}


@router.get("/inventory/report", summary="盘点报告（各态统计 + 异常清单 + 差异）")
def inventory_report(building: Optional[str] = Query(None, max_length=64),
                     db: Session = Depends(get_db), _: User = _login):
    """盘点报告：方案 3.2 第⑥步「本次盘点 X 个房间 / 发现差异 Y 处 / 耗时 Z」的数据源。"""
    rooms = db.query(AR.Room)
    if building:
        rooms = rooms.filter(AR.Room.building == building)
    rooms = rooms.all()
    rec_map = {r.room_code: r for r in db.query(RoomInventoryRecord).all()}

    total = 0
    pending = 0
    doing = 0
    completed = 0
    abnormal = 0
    scanned_sum = 0
    expected_sum = 0
    diff_total = 0
    empty_confirmed = 0
    abnormal_items: List[Dict[str, Any]] = []
    operator = ""
    last_at: Optional[datetime] = None

    for room in rooms:
        total += 1
        rec = rec_map.get(room.code)
        expected = len(AR._room_bound_codes(db, room))
        expected_sum += expected
        if rec is None:
            pending += 1
            continue
        st = rec.status or "pending"
        if st == "doing":
            doing += 1
        elif st == "completed":
            completed += 1
            if rec.empty_confirmed:
                empty_confirmed += 1
        elif st == "abnormal":
            abnormal += 1
            abnormal_items.append({
                "room_code": room.code, "room_name": room.name,
                "building": room.building, "floor": room.floor,
                "scanned_count": int(rec.scanned_count or 0),
                "expected_count": expected,
                "reason": rec.abnormal_reason or "",
                "operator": rec.operator or "",
                "completed_at": rec.completed_at.isoformat() if rec.completed_at else None,
            })
        else:
            pending += 1
        scanned_sum += int(rec.scanned_count or 0)
        if rec.operator:
            operator = rec.operator
        if rec.completed_at and (last_at is None or rec.completed_at > last_at):
            last_at = rec.completed_at

    percent = round((completed + abnormal) / total * 100, 1) if total else 0.0
    return {
        "total_rooms": total,
        "pending_rooms": pending,
        "doing_rooms": doing,
        "completed_rooms": completed,
        "abnormal_rooms": abnormal,
        "empty_confirmed_rooms": empty_confirmed,
        "scanned_total": scanned_sum,
        "expected_total": expected_sum,
        "diff_total": diff_total,
        "percent": percent,
        "operator": operator,
        "last_at": last_at.isoformat() if last_at else None,
        "abnormal_items": abnormal_items[:100],
    }