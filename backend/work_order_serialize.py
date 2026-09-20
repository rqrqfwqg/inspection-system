"""运维执行域 · ORM → 契约形状的映射（纯函数，无副作用）。

单独成模块的理由：序列化是**跨层关注点**（工单路由、离线同步都要用），
放在 service 里会让 service 越过 300 行门禁；抽出来后各层按需 import，职责更清。
本模块不做 IO、不碰数据库、不做权限判定。
"""
from typing import Any, Dict

from work_order_models import WorkOrder


def serialize(wo: WorkOrder) -> Dict[str, Any]:
    """工单 → 契约 WorkOrder 形状（datetime 交由响应模型序列化）。"""
    return {
        "id": wo.id, "code": wo.code, "title": wo.title,
        "description": wo.description, "type": wo.type,
        "failure_flag": bool(wo.failure_flag), "status": wo.status,
        "priority": wo.priority, "asset_device_code": wo.asset_device_code,
        "room_code": wo.room_code, "subsystem_code": wo.subsystem_code,
        "reporter_id": wo.reporter_id, "assignee_id": wo.assignee_id,
        "reviewer_id": wo.reviewer_id, "source": wo.source,
        "alert_id": wo.alert_id, "parent_id": wo.parent_id,
        "due_at": wo.due_at, "started_at": wo.started_at,
        "completed_at": wo.completed_at, "closed_at": wo.closed_at,
        "version": wo.version, "created_at": wo.created_at,
        "updated_at": wo.updated_at, "meta": wo.meta or {},
    }


def serialize_event(ev) -> Dict[str, Any]:
    """审计事件 → 契约 WorkOrderEvent 形状。"""
    return {
        "id": ev.id, "work_order_id": ev.work_order_id,
        "event_type": ev.event_type, "from_status": ev.from_status,
        "to_status": ev.to_status, "actor_id": ev.actor_id,
        "payload": ev.payload or {}, "client_op_id": ev.client_op_id,
        "created_at": ev.created_at,
    }
