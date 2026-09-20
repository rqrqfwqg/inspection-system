"""运维执行域 · 工单服务（业务逻辑 / 事务编排）。

分层纪律
--------
- 本层是**唯一**业务规则所在：状态机迁移、权限位判定、乐观锁版本推进、事件写入。
  路由层只做「校验 → 调 service → 组装响应」，不直连数据库。
- 所有业务失败一律抛 `ops_errors.ApiError`（→ 契约错误体），不抛裸 HTTPException。
- 事务边界在本层：一次动作 = 一个事务（改状态 + 写事件一起 commit）。
- 引用校验见 `work_order_refs`（C1/C2），形状映射见 `work_order_serialize`。

关键口径
--------
- **C6**：状态迁移只认 `work_order_state` 的转换表；事件只增不改（仓储层无 UPDATE/DELETE）。
- **C7 / AC-07**：`expected_version` 不等 → 409 + serverVersion，由客户端决定，不自动覆盖。
- **reopen 语义**：重开产生**新单**（`parent_id` 指向原单），原单保持 closed/cancelled
  —— 与 `parent_id` 定位「重开/异常转正/克隆来源」一致，且已关闭单的状态不被回溯改写。
- 验收通过写两条事件（`reviewed_approved` 决策 + `closed` 终态），时间线更完整。
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pydantic import ValidationError
from sqlalchemy.orm import Session

from database import User
from ops_errors import bad_request, forbidden, not_found, unprocessable, version_conflict
from ops_rbac import has_permission
from work_order_models import WorkOrder
from work_order_refs import validate_device_code, validate_room_code
from work_order_repository import (
    add_work_order, get_work_order, insert_event,
    list_events, list_work_orders, next_daily_code,
)
from work_order_schemas import WorkOrderCreate
from work_order_state import (
    EV_CLOSED, EV_CREATED, EV_FIELD_CHANGED, EV_REOPENED, EV_SYNC_CONFLICT,
    REOPEN_FROM, REOPEN_TARGETS, ST_CLOSED, ST_IN_PROGRESS, ST_PENDING_DISPATCH,
    ST_PENDING_REVIEW, action_meta, can_apply, review_action_name,
)
from work_order_serialize import serialize, serialize_event


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _pydantic_msg(exc: ValidationError) -> str:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    msg = first.get("msg", "参数错误")
    return f"{loc}: {msg}" if loc else msg


def _prune(payload: Dict[str, Any]) -> Dict[str, Any]:
    """按 OpenAPI §6.1「缺省键省略（不写 null）」剔除值为 None 的键。

    只删 None，保留 `False` / `0` / `""` / `[]` 等合法值（如 approved=False）。
    """
    return {k: v for k, v in payload.items() if v is not None}


# ==================== 查询 / 装配 ====================

def get_detail(db: Session, wo_id: int, include_events: bool = True) -> Dict[str, Any]:
    """工单详情（含 events）。"""
    wo = get_work_order(db, wo_id)
    if wo is None:
        raise not_found(f"工单 {wo_id} 不存在")
    out = serialize(wo)
    out["events"] = ([serialize_event(e) for e in list_events(db, wo_id)]
                     if include_events else [])
    return out


def list_page(db: Session, **filters: Any) -> Dict[str, Any]:
    """分页列表（契约 WorkOrderPage）。"""
    page = max(1, int(filters.pop("page", 1) or 1))
    page_size = max(1, min(int(filters.pop("page_size", 20) or 20), 200))
    rows, total = list_work_orders(db, page=page, page_size=page_size, **filters)
    return {
        "items": [serialize(r) for r in rows],
        "total": total, "page": page, "page_size": page_size,
        "has_more": page * page_size < total,
    }


# ==================== 建单 ====================

def _persist_new(db: Session, *, actor_id: int, title: str, wo_type: str,
                 failure_flag: bool, priority: str, asset_device_code: Optional[str],
                 room_code: Optional[str], subsystem_code: str, description: str,
                 reporter_id: int, assignee_id: Optional[int], due_at: Any,
                 source: str, parent_id: Optional[int], meta: Dict[str, Any],
                 client_op_id: Optional[str] = None) -> WorkOrder:
    """落库一张 `pending_dispatch` 工单 + `created` 事件（同一事务）。"""
    wo = add_work_order(
        db, code=next_daily_code(db, "WO"), title=title, description=description,
        type=wo_type, failure_flag=failure_flag, status=ST_PENDING_DISPATCH,
        priority=priority, asset_device_code=asset_device_code, room_code=room_code,
        subsystem_code=subsystem_code or "", reporter_id=reporter_id,
        assignee_id=assignee_id, source=source, parent_id=parent_id,
        due_at=due_at, version=1, meta=meta or {},
    )
    db.flush()
    insert_event(
        db, work_order_id=wo.id, event_type=EV_CREATED, from_status=None,
        to_status=ST_PENDING_DISPATCH, actor_id=actor_id,
        payload=_prune({"title": title, "type": wo_type, "source": source,
                        "asset_device_code": asset_device_code, "room_code": room_code,
                        "parent_id": parent_id}),
        client_op_id=client_op_id,
    )
    db.commit()
    db.refresh(wo)
    return wo


def create_work_order(db: Session, actor: User, payload: Dict[str, Any], *,
                      source: Optional[str] = None,
                      client_op_id: Optional[str] = None,
                      parent_id: Optional[int] = None) -> WorkOrder:
    """POST /ops/api/work-orders 与 sync(wo_create) 的共用实现。"""
    try:
        data = WorkOrderCreate.model_validate(payload or {})
    except ValidationError as exc:
        raise bad_request(_pydantic_msg(exc))
    device_code = validate_device_code(db, data.asset_device_code)
    room_code = validate_room_code(db, data.room_code)
    reporter_id = data.reporter_id or actor.id
    if data.reporter_id is not None and not db.query(User.id).filter(
            User.id == data.reporter_id).first():
        raise bad_request(f"reporter_id {data.reporter_id} 对应用户不存在")
    return _persist_new(
        db, actor_id=actor.id, title=data.title, wo_type=data.type,
        failure_flag=bool(data.failure_flag), priority=data.priority or "medium",
        asset_device_code=device_code, room_code=room_code,
        subsystem_code=data.subsystem_code or "", description=data.description or "",
        reporter_id=reporter_id, assignee_id=None, due_at=data.due_at,
        source=(source or data.source or "web"), parent_id=parent_id,
        meta=data.meta or {}, client_op_id=client_op_id,
    )


# ==================== 状态迁移（REST 与 /sync 共用唯一实现） ====================

def _load(db: Session, wo_id: int) -> WorkOrder:
    wo = get_work_order(db, wo_id)
    if wo is None:
        raise not_found(f"工单 {wo_id} 不存在")
    return wo


def _apply_version_guard(wo: WorkOrder, expected_version: Optional[int]) -> None:
    if expected_version is not None and int(expected_version) != int(wo.version):
        raise version_conflict(
            f"版本冲突：客户端 version={expected_version}，服务端 version={wo.version}",
            server_version=int(wo.version))


def _check_permission(actor: User, permission: str) -> None:
    if not has_permission(actor, permission):
        raise forbidden(f"缺少权限位 {permission}")


def apply_action(db: Session, actor: User, wo_id: int, action: str, *,
                 payload: Optional[Dict[str, Any]] = None,
                 approved: Optional[bool] = None,
                 target_status: Optional[str] = None,
                 client_op_id: Optional[str] = None,
                 expected_version: Optional[int] = None) -> WorkOrder:
    """执行一次状态迁移（REST 动作端点与离线 `wo_action` 共用此唯一实现）。

    `action` ∈ dispatch|start|complete|submit_review|review|cancel|reopen。

    乐观锁顺序铁律（不要改）：权限 -> 版本 -> 状态机
      1) 权限优先：若先做版本校验，版本不符时返回 409 会向无权限者泄露
         「这单存在 / 归谁」；故必须权限先拦。
      2) 版本早于状态机：版本不符返回 409「别人改过了」比 422「状态机非法迁移」
         更可操作 —— 用户该看到的是冲突，而不是以为操作本身不合法。
      3) expected_version 为 None -> 完全跳过版本校验（老客户端 / 离线链路兼容）。
    """
    payload = dict(payload or {})
    wo = _load(db, wo_id)

    norm = review_action_name(bool(approved)) if action == "review" else action
    if norm == "reopen":
        return _do_reopen(db, actor, wo, target_status=target_status,
                          note=payload.get("note"), client_op_id=client_op_id,
                          expected_version=expected_version)

    spec = action_meta(norm)
    if spec is None:
        raise bad_request(f"未知动作「{action}」")
    _check_permission(actor, spec["permission"])          # 1 权限优先
    _apply_version_guard(wo, expected_version)            # 2 版本早于状态机

    ok, to_status = can_apply(norm, wo.status, approved)
    if not ok:
        raise unprocessable(f"状态机非法迁移：当前状态 {wo.status} 不允许执行 {action}")

    # AC-04：start 限本人（assignee）
    if spec.get("self_only") and wo.assignee_id != actor.id:
        raise forbidden(
            f"工单 {wo.code} 的指派人不是你（assignee_id={wo.assignee_id}），不能开始执行")

    from_status = wo.status
    now = _utcnow()
    event_payload: Dict[str, Any] = ({"note": payload.get("note")}
                                     if payload.get("note") else {})

    if norm == "dispatch":
        assignee_id = payload.get("assignee_id")
        if assignee_id is None:
            raise bad_request("dispatch 必须提供 assignee_id")
        if not db.query(User.id).filter(User.id == int(assignee_id)).first():
            raise bad_request(f"assignee_id {assignee_id} 对应用户不存在")
        wo.assignee_id = int(assignee_id)
        event_payload["assignee_id"] = int(assignee_id)
    elif norm == "start":
        wo.started_at = now
    elif norm == "complete":
        wo.completed_at = now
        photos = list(payload.get("photo_urls") or [])
        if photos:
            meta = dict(wo.meta or {})
            meta["completion_photos"] = photos
            wo.meta = meta
            event_payload["photo_urls"] = photos
    elif norm == "review_approve":
        wo.closed_at = now
        wo.reviewer_id = actor.id
        event_payload["approved"] = True
    elif norm == "review_reject":
        wo.reviewer_id = actor.id
        event_payload["approved"] = False
    elif norm == "cancel":
        reason = (payload.get("reason") or "").strip()
        if not reason:
            raise bad_request("cancel 必须提供 reason")
        wo.cancelled_at = now
        event_payload["reason"] = reason

    wo.status = to_status
    wo.version = int(wo.version) + 1
    insert_event(db, work_order_id=wo.id, event_type=spec["event"],
                 from_status=from_status, to_status=to_status, actor_id=actor.id,
                 payload=_prune(event_payload), client_op_id=client_op_id)
    if norm == "review_approve":
        # 决策事件之后再补一条终态事件，验收时间线不丢「谁批准 + 何时关闭」
        insert_event(db, work_order_id=wo.id, event_type=EV_CLOSED,
                     from_status=ST_PENDING_REVIEW, to_status=ST_CLOSED,
                     actor_id=actor.id, payload=_prune({"note": payload.get("note")}),
                     client_op_id=client_op_id)
    db.commit()
    db.refresh(wo)
    return wo


def _do_reopen(db: Session, actor: User, wo: WorkOrder, *, target_status: Optional[str],
               note: Optional[str], client_op_id: Optional[str],
               expected_version: Optional[int] = None) -> WorkOrder:
    """重开：产生新单（parent_id 指向原单），原单状态不被回溯改写。

    expected_version 守的是原单（wo）的版本 —— 重开作用于原单、产生新单。
    同样遵循顺序铁律：权限 -> 版本 -> 状态机。
    """
    _check_permission(actor, "wo.review")
    _apply_version_guard(wo, expected_version)
    if wo.status not in REOPEN_FROM:
        raise unprocessable(
            f"状态机非法迁移：{wo.status} 不是可重开状态（closed/cancelled）")
    if target_status not in REOPEN_TARGETS:
        raise bad_request(f"target_status 必须是 {'/'.join(REOPEN_TARGETS)} 之一")

    new_wo = _persist_new(
        db, actor_id=actor.id, title=wo.title, wo_type=wo.type,
        failure_flag=bool(wo.failure_flag), priority=wo.priority,
        asset_device_code=wo.asset_device_code, room_code=wo.room_code,
        subsystem_code=wo.subsystem_code or "",
        description=(wo.description or ""), reporter_id=wo.reporter_id,
        assignee_id=wo.assignee_id, due_at=None, source=wo.source or "web",
        parent_id=wo.id, meta=dict(wo.meta or {}), client_op_id=client_op_id,
    )
    new_wo.status = target_status
    if target_status == ST_IN_PROGRESS:
        new_wo.started_at = _utcnow()
    insert_event(db, work_order_id=wo.id, event_type=EV_REOPENED,
                 from_status=wo.status, to_status=target_status, actor_id=actor.id,
                 payload=_prune({"reopened_work_order_id": new_wo.id,
                                 "reopened_code": new_wo.code,
                                 "target_status": target_status, "note": note}),
                 client_op_id=client_op_id)
    db.commit()
    db.refresh(new_wo)
    return new_wo


def update_fields(db: Session, actor: User, wo_id: int, fields: Dict[str, Any], *,
                  expected_version: int, client_op_id: Optional[str] = None) -> WorkOrder:
    """离线 `wo_update`：白名单字段 + **必须**版本一致，应用后 version+1。

    与契约一致：version 不一致 → 409 + serverVersion（AC-07，绝不自动覆盖）。
    """
    allowed = ("title", "description", "priority", "due_at", "subsystem_code",
               "failure_flag", "meta")
    wo = _load(db, wo_id)
    _apply_version_guard(wo, expected_version)

    changed: Dict[str, Any] = {}
    for key in allowed:
        if key not in fields:
            continue
        value = fields[key]
        if key == "priority" and value not in ("low", "medium", "high", "urgent"):
            raise bad_request(f"priority 取值非法：{value}")
        if key == "title":
            value = (value or "").strip()
            if not value:
                raise bad_request("title 不能为空")
        if getattr(wo, key) != value:
            setattr(wo, key, value)
            changed[key] = value

    wo.version = int(wo.version) + 1
    insert_event(db, work_order_id=wo.id, event_type=EV_FIELD_CHANGED,
                 from_status=wo.status, to_status=wo.status, actor_id=actor.id,
                 payload={"fields": changed}, client_op_id=client_op_id)
    db.commit()
    db.refresh(wo)
    return wo


def record_sync_conflict(db: Session, actor: User, wo_id: int, *,
                         client_version: int, server_version: int,
                         client_op_id: Optional[str] = None) -> None:
    """冲突留痕（`sync_conflict` 事件）。不改状态、不推进版本（C7：由用户决定）。"""
    insert_event(db, work_order_id=wo_id, event_type=EV_SYNC_CONFLICT,
                 from_status=None, to_status=None, actor_id=actor.id,
                 payload={"client_version": client_version,
                          "server_version": server_version},
                 client_op_id=client_op_id)
    db.commit()

