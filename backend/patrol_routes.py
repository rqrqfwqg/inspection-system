"""巡查打卡域 · 路由层（`/routes*`、`/stats/patrol`、工单 PUT/DELETE 与打卡）。

职责边界：路由只做「挂依赖 → 取当前用户 → 调 service → 组装响应」，
**不写业务逻辑**、不直连数据库（分层硬门禁，与 work_order_routes 一致）。

🔴 路由顺序硬约束
----------------
`/routes/available-nodes` **必须**注册在 `/routes/{route_id}` **之前**，
否则 GET /routes/available-nodes 会被 `{route_id}` 捕获并拿 "available-nodes"
去查整型主键 → 422/500。同源坑见 work_order_routes 里 /work-orders/sync 的注释。
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import patrol_service as svc
from database import User, get_db
from dependencies import get_current_user
from ops_errors import ApiError, bad_request, CODE_VERSION_CONFLICT, not_found
from ops_rbac import PERM_CREATE, PERM_EXECUTE, require_permission
from patrol_schemas import (
    CheckinCreate, CheckinOut, CheckinResult, PatrolStats, RouteCreate,
    RouteDetail, RouteNodeAppend, RouteNodeOut, RouteOut,
    WoNodeOut, WorkOrderUpdate,
)
from work_order_schemas import WorkOrder

router = APIRouter(tags=["patrol"])

# 读接口 = 登录即可（与工单域同一口径）
_login = Depends(get_current_user)


# ==================== 线路 CRUD ====================

@router.get("/routes", response_model=list[RouteOut],
            summary="线路列表（含节点数）")
def list_routes(status: Optional[Literal["active", "archived"]] = None,
                q: Optional[str] = None,
                db: Session = Depends(get_db), _: User = _login):
    return svc.list_routes(db, status=status, q=q)


# ⚠️ 必须在 /routes/{route_id} 之前注册（见模块 docstring）
@router.get("/routes/available-nodes",
            summary="可选节点清单（全部房间/区域）")
def available_nodes(node_type: Literal["room", "area"] = "room",
                    q: Optional[str] = None,
                    db: Session = Depends(get_db), _: User = _login):
    return svc.available_nodes(db, node_type=node_type, q=q)


@router.get("/routes/{route_id}", response_model=RouteDetail,
            summary="线路详情（含节点清单）")
def route_detail(route_id: int, db: Session = Depends(get_db), _: User = _login):
    data = svc.get_route(db, route_id)
    if data is None:
        raise not_found(f"线路 {route_id} 不存在")
    return data


@router.post("/routes", response_model=RouteDetail, status_code=201,
             summary="新建线路")
def create_route(payload: RouteCreate, db: Session = Depends(get_db),
                 actor: User = Depends(require_permission(PERM_CREATE))):
    try:
        return svc.create_route(db, actor.id, payload.model_dump())
    except ValueError as e:
        raise bad_request(str(e))


@router.put("/routes/{route_id}", response_model=RouteDetail,
            summary="编辑线路（nodes 给了即全量替换）")
def update_route(route_id: int, payload: RouteCreate,
                 db: Session = Depends(get_db), _: User = _login):
    data = svc.update_route(db, route_id, payload.model_dump())
    if data is None:
        raise not_found(f"线路 {route_id} 不存在")
    return data


@router.delete("/routes/{route_id}", summary="删除线路（级联删节点）")
def delete_route(route_id: int, db: Session = Depends(get_db),
                 actor: User = Depends(require_permission(PERM_CREATE))):
    ok = svc.delete_route(db, route_id)
    if not ok:
        raise not_found(f"线路 {route_id} 不存在")
    return {"success": True, "message": "线路已删除"}


# ==================== 线路节点 ====================

@router.post("/routes/{route_id}/nodes", response_model=RouteDetail,
             summary="追加节点（扫码加节点）")
def append_node(route_id: int, payload: RouteNodeAppend,
                db: Session = Depends(get_db), _: User = _login):
    try:
        data = svc.append_node(db, route_id, payload.model_dump())
    except ValueError as e:
        # 同房间重复加 → 409「该房间已在线路中」
        if str(e) == "dup_room":
            raise ApiError(409, CODE_VERSION_CONFLICT, "该房间已在线路中")
        raise bad_request(str(e))
    if data is None:
        raise not_found(f"线路 {route_id} 不存在")
    return data


@router.delete("/routes/{route_id}/nodes/{node_id}", summary="删除节点")
def delete_node(route_id: int, node_id: int, db: Session = Depends(get_db),
                _: User = _login):
    ok = svc.delete_node(db, route_id, node_id)
    if not ok:
        raise not_found(f"节点 {node_id} 不存在于线路 {route_id}")
    return {"success": True, "message": "节点已删除"}


# ==================== 打卡 ====================

@router.post("/work-orders/{wo_id}/checkin", response_model=CheckinResult,
             summary="节点打卡（同一工单同一节点幂等，重复返 409）")
def checkin(wo_id: int, payload: CheckinCreate, db: Session = Depends(get_db),
            actor: User = Depends(require_permission(PERM_EXECUTE))):
    result, err = svc.checkin(db, wo_id, actor.id, payload.model_dump())
    if err:
        if err == "not_found":
            raise not_found(f"工单 {wo_id} 不存在")
        if err == "dup":
            raise ApiError(409, CODE_VERSION_CONFLICT, "该节点已打卡")
        msg = {
            "node_invalid": "节点不属于该工单的线路",
            "remark_required": "标记异常时必须填写说明",
            "invalid_state": "当前工单状态不允许打卡",
        }.get(err, err)
        raise bad_request(msg)
    return result


@router.get("/work-orders/{wo_id}/checkins", response_model=list[CheckinOut],
            summary="打卡记录列表")
def list_checkins(wo_id: int, db: Session = Depends(get_db), _: User = _login):
    return svc.list_checkins(db, wo_id)


@router.get("/work-orders/{wo_id}/nodes", response_model=list[WoNodeOut],
            summary="工单的线路节点 + 各节点打卡状态（工单详情页一次拿齐）")
def wo_nodes(wo_id: int, db: Session = Depends(get_db), _: User = _login):
    """未挂线路的工单返回空数组（前端据此隐藏打卡区块）。"""
    from work_order_models import WorkOrder
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        raise not_found(f"工单 {wo_id} 不存在")
    return svc.wo_nodes_with_checkin(db, wo)


# ==================== 工单编辑 / 删除（补齐线上缺失的 PUT / DELETE）====================

@router.put("/work-orders/{wo_id}", response_model=WorkOrder,
            summary="编辑工单（带 version 乐观锁）")
def update_work_order(wo_id: int, payload: WorkOrderUpdate,
                      db: Session = Depends(get_db),
                      actor: User = Depends(require_permission(PERM_CREATE))):
    data, err = svc.update_work_order(db, wo_id, actor.id, payload.model_dump())
    if err == "not_found":
        raise not_found(f"工单 {wo_id} 不存在")
    if err == "conflict":
        # 版本冲突：带 serverVersion，前端刷新后可重试
        raise ApiError(409, CODE_VERSION_CONFLICT,
                       "工单已被他人修改（版本冲突），请刷新后重试")
    if err == "invalid_state":
        raise bad_request("当前工单状态不允许编辑")
    return data


@router.delete("/work-orders/{wo_id}", summary="删除工单（仅待派发/已取消可删）")
def delete_work_order(wo_id: int, db: Session = Depends(get_db),
                      actor: User = Depends(require_permission(PERM_CREATE))):
    ok, err = svc.delete_work_order(db, wo_id)
    if err == "not_found":
        raise not_found(f"工单 {wo_id} 不存在")
    if err == "invalid_state":
        raise bad_request("仅待派发或已取消的工单可删除")
    return {"success": True, "message": "工单已删除"}


# ==================== 首页统计 ====================

@router.get("/stats/patrol", response_model=PatrolStats,
            summary="首页生产数据：工单数 / 打卡率 / 逾期数")
def patrol_stats(db: Session = Depends(get_db), _: User = _login):
    return svc.patrol_stats(db)
