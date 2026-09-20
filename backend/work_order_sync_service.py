"""运维执行域 · 离线批量同步（`POST /ops/api/work-orders/sync`）。

契约（OpenAPI work-order-sync + §4 离线协议要点）
------------------------------------------------
- 客户端把离线队列**按序**上传；服务端按 `client_op_id` 记 `sync_receipts` 保证幂等
  （重试不重复应用）。
- 每条**独立处理**，单条失败不影响其余条目（逐条返回结果）。
- 三类可执行 op：`wo_create` / `wo_update` / `wo_action`。
  `photo` 不走此端点（先经 `/ops/api/attachments/upload` 拿 URL，再随 payload 提交）。
- `wo_update` 携带 `version`：与服务端一致才应用并 `version+1`；
  否则返回 `conflict` + `serverVersion`，由**用户决定**，绝不自动覆盖（AC-07 / C7）。

幂等边界（刻意设计）
--------------------
只对 `accepted` 落收据。`conflict` / `error` **不落** —— 否则用户解决冲突后重试
同一 op 会读到旧的 conflict 收据，永远无法真正重放。
"""
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from database import User
from ops_errors import ApiError
from work_order_repository import get_receipt, put_receipt
from work_order_schemas import PendingOp
from work_order_service import (
    apply_action, create_work_order, record_sync_conflict, update_fields,
)


def _accepted(op_id: str, server_id: Optional[int],
              server_version: Optional[int]) -> Dict[str, Any]:
    return {"clientOpId": op_id, "status": "accepted",
            "serverId": server_id, "serverVersion": server_version, "message": None}


def _conflict(op_id: str, server_id: Optional[int], server_version: Optional[int],
              message: str) -> Dict[str, Any]:
    return {"clientOpId": op_id, "status": "conflict", "serverId": server_id,
            "serverVersion": server_version, "message": message}


def _error(op_id: str, message: str) -> Dict[str, Any]:
    return {"clientOpId": op_id, "status": "error", "serverId": None,
            "serverVersion": None, "message": message}


def _entity_id(op: PendingOp) -> Optional[int]:
    try:
        return int(str(op.entityId))
    except (TypeError, ValueError):
        return None


def _handle_op(db: Session, actor: User, op: PendingOp) -> Dict[str, Any]:
    """处理单条 op；返回契约 SyncResult（dict）。"""
    payload = dict(op.payload or {})

    if op.kind == "wo_create":
        wo = create_work_order(db, actor, payload, client_op_id=op.id)
        return _accepted(op.id, wo.id, int(wo.version))

    if op.kind == "wo_update":
        wo_id = _entity_id(op)
        if wo_id is None:
            return _error(op.id, "wo_update 必须携带 entityId（服务端工单 id）")
        if op.version is None:
            return _error(op.id, "wo_update 必须携带 version（乐观锁基准版本）")
        try:
            wo = update_fields(db, actor, wo_id, payload,
                               expected_version=int(op.version), client_op_id=op.id)
        except ApiError as exc:
            if exc.http_status == 409:
                record_sync_conflict(db, actor, wo_id,
                                     client_version=int(op.version),
                                     server_version=int(exc.server_version or 0),
                                     client_op_id=op.id)
                return _conflict(op.id, wo_id, exc.server_version, exc.detail)
            raise
        return _accepted(op.id, wo.id, int(wo.version))

    if op.kind == "wo_action":
        wo_id = _entity_id(op)
        if wo_id is None:
            return _error(op.id, "wo_action 必须携带 entityId（服务端工单 id）")
        if not op.action:
            return _error(op.id, "wo_action 必须携带 action")
        approved = payload.get("approved")
        wo = apply_action(
            db, actor, wo_id, op.action, payload=payload,
            approved=approved if isinstance(approved, bool) else None,
            target_status=payload.get("target_status"),
            client_op_id=op.id,
            expected_version=None,      # 契约只对 wo_update 定义 409；动作不按版本拦截
        )
        return _accepted(op.id, wo.id, int(wo.version))

    if op.kind == "photo":
        return _error(op.id, "photo 请先经 /ops/api/attachments/upload 上传，"
                             "再把返回 url 写入 wo_create/wo_update.payload")

    return _error(op.id, f"未知 op.kind：{op.kind}")


def sync_ops(db: Session, actor: User, ops: List[PendingOp]) -> Dict[str, Any]:
    """逐条处理并返回 `{results: [...]}`（顺序与请求一致）。"""
    results: List[Dict[str, Any]] = []
    for op in ops:
        receipt = get_receipt(db, op.id)
        if receipt is not None:
            # 幂等回放：重试不重复应用，直接返回首次受理结果
            cached = dict(receipt.result or {})
            cached["clientOpId"] = op.id
            results.append(cached)
            continue

        try:
            result = _handle_op(db, actor, op)
        except ApiError as exc:
            db.rollback()
            if exc.http_status == 409:
                result = _conflict(op.id, None, exc.server_version, exc.detail)
            else:
                result = _error(op.id, exc.detail)
        except Exception as exc:                       # noqa: BLE001 — 逐条隔离，不让一条拖垮整批
            db.rollback()
            result = _error(op.id, f"服务端处理异常：{exc.__class__.__name__}")

        if result["status"] == "accepted":
            try:
                put_receipt(db, op.id, result, server_id=result.get("serverId"))
                db.commit()
            except Exception:                          # noqa: BLE001 — 收据写失败不影响本次结果
                db.rollback()
        results.append(result)

    return {"results": results}
