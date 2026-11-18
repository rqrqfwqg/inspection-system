"""巡查打卡域 · 服务层（业务规则唯一所在地）。

🔴 分层硬门禁：路由层不得写业务逻辑、不得直连数据库；本模块是唯一的规则出口。

关键规则（易错点，逐条对齐产品口径）
------------------------------------
1. **打卡幂等**：同一 `(work_order_id, node_id)` 只允许一条。
   应用层先查 → 已有则 409「该节点已打卡」；DB 唯一索引是最后防线（并发兜底）。
2. **无顺序约束**：打卡只认 `node_id`，**不校验 seq 前后**。前端按
   「线路全部节点 − 已打卡」算待打卡列表，用户任选先打。
3. **全打完自动推进**：当「已打卡数 == 应打卡节点数」且工单处于 `in_progress`，
   自动置 `completed`（并写 `work_order_events` 事件），与产品「工单完成时自动
   置 completed」一致。**不自动进 pending_review** —— 验收是管理动作，须人工点。
4. **逾期只读不改 status**：`now > due_at` 且未终态时，仅在响应里给
   `overdue=True` 供界面打红角标 + 首页计数；**绝不改 status**（改了会破坏
   「逾期工单」查询口径）。
5. **应打卡节点数**只数 `require_checkin=1` 的节点；`require_checkin=0` 是
   「路过/参考点」，不计入完成条件，但仍在详情里展示。
6. 时间统一 UTC；打卡时间用 `checked_at`（可被客户端带，服务端缺省 now）。
"""
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

import work_order_state as st
import beacon_service  # 蓝牙信标第二因子校验（2026-11-18）
from database import DeviceGeoObservation
from patrol_models import InspectionCheckin, InspectionRoute, InspectionRouteNode
from work_order_models import WorkOrder, WorkOrderEvent

# 工单挂线路：存 meta.route_id，不改表结构
ROUTE_META_KEY = "route_id"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _norm_dt(dt: Optional[datetime]) -> Optional[datetime]:
    """把 naive 时间当作 UTC 归一，避免与库内带时区值比较时报 TypeError。"""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _parse_meta(meta: Any) -> Dict[str, Any]:
    """安全解析 work_orders.meta（可能是 str / None / dict）。"""
    if isinstance(meta, dict):
        return meta
    if isinstance(meta, str) and meta.strip():
        import json
        try:
            v = json.loads(meta)
            return v if isinstance(v, dict) else {}
        except Exception:
            return {}
    return {}


# =====================================================================
# 线路编号生成：RT-YYYYMMDD-NNN（当日流水）
# =====================================================================

def _next_route_code(db: Session) -> str:
    today = _utcnow().strftime("%Y%m%d")
    prefix = f"RT-{today}-"
    cnt = db.execute(
        select(func.count()).select_from(InspectionRoute).where(
            InspectionRoute.code.like(f"{prefix}%")
        )
    ).scalar_one()
    return f"{prefix}{cnt + 1:03d}"


# =====================================================================
# 线路 CRUD
# =====================================================================

def list_routes(db: Session, status: Optional[str] = None,
                q: Optional[str] = None) -> List[Dict[str, Any]]:
    stmt = select(InspectionRoute)
    if status:
        stmt = stmt.where(InspectionRoute.status == status)
    if q and q.strip():
        stmt = stmt.where(InspectionRoute.name.like(f"%{q.strip()}%"))
    stmt = stmt.order_by(InspectionRoute.id.desc())

    routes = db.execute(stmt).scalars().all()
    # 一次性把 node_count 查出来，避免 N+1
    counts = dict(
        db.execute(
            select(InspectionRouteNode.route_id, func.count())
            .group_by(InspectionRouteNode.route_id)
        ).all()
    )
    out = []
    for r in routes:
        d = {c.name: getattr(r, c.name) for c in InspectionRoute.__table__.columns}
        d["node_count"] = int(counts.get(r.id, 0))
        out.append(d)
    return out


def get_route(db: Session, route_id: int) -> Optional[Dict[str, Any]]:
    r = db.get(InspectionRoute, route_id)
    if not r:
        return None
    d = {c.name: getattr(r, c.name) for c in InspectionRoute.__table__.columns}
    nodes = list_nodes(db, route_id)
    d["node_count"] = len(nodes)
    d["nodes"] = [_node_out(n) for n in nodes]
    return d


def list_nodes(db: Session, route_id: int) -> List[InspectionRouteNode]:
    return list(
        db.execute(
            select(InspectionRouteNode)
            .where(InspectionRouteNode.route_id == route_id)
            .order_by(InspectionRouteNode.seq, InspectionRouteNode.id)
        ).scalars().all()
    )


def _node_out(n: InspectionRouteNode) -> Dict[str, Any]:
    return {c.name: getattr(n, c.name) for c in InspectionRouteNode.__table__.columns}


def create_route(db: Session, actor_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    r = InspectionRoute(
        code=_next_route_code(db),
        name=payload["name"],
        description=payload.get("description") or "",
        status=payload.get("status") or "active",
        owner_id=payload.get("owner_id") or actor_id,
    )
    db.add(r)
    db.flush()                     # 取 id

    for i, nd in enumerate(payload.get("nodes") or []):
        db.add(_build_node(r.id, i, nd))

    db.commit()
    db.refresh(r)
    return get_route(db, r.id)  # type: ignore[return-value]


def _build_node(route_id: int, seq: int, nd: Dict[str, Any]) -> InspectionRouteNode:
    """构造节点（create / update 共用，保证字段口径一致）。"""
    node_type = nd.get("node_type") or "room"
    room_code = (nd.get("room_code") or "").strip() or None
    area_code = (nd.get("area_code") or "").strip() or None
    # node_type=room 必须给 room_code，否则节点无法定位
    if node_type == "room" and not room_code:
        raise ValueError("房间型节点必须提供 room_code")
    return InspectionRouteNode(
        route_id=route_id,
        seq=nd.get("seq") if nd.get("seq") is not None else seq,
        node_type=node_type,
        room_code=room_code,
        area_code=area_code,
        qr_payload=(nd.get("qr_payload") or "") or None,
        snapshot_name=nd.get("snapshot_name") or "",
        require_checkin=bool(nd.get("require_checkin", True)),
    )



# ===== 线路节点防误清（2026-10-26 线上事故整改）=====
# 背景：update_route 的 nodes 是「整表替换」，前端提交清单不全就会静默丢节点。
_ROUTE_HIST_READY = False


def _route_edit_log(rec):
    """把每次线路节点保存/被拦截写成一行 JSON 到 backend/logs/route_edit.log。"""
    import json as _json
    import logging as _logging
    import os as _os
    base = _os.path.dirname(_os.path.abspath(__file__))
    logdir = _os.path.join(base, 'logs')
    try:
        _os.makedirs(logdir, exist_ok=True)
    except Exception:
        pass
    logger = _logging.getLogger('route_edit')
    if not logger.handlers:
        h = _logging.FileHandler(_os.path.join(logdir, 'route_edit.log'), encoding='utf-8')
        h.setFormatter(_logging.Formatter('%(message)s'))
        logger.addHandler(h)
        logger.setLevel(_logging.INFO)
        logger.propagate = False
    try:
        logger.info(_json.dumps(rec, ensure_ascii=False))
    except Exception:
        pass


def _ensure_route_history(db):
    """保证节点历史表存在（幂等；不依赖 init_db 的迁移）。"""
    global _ROUTE_HIST_READY
    if _ROUTE_HIST_READY:
        return
    from sqlalchemy import text as _text
    db.execute(_text(
        'CREATE TABLE IF NOT EXISTS inspection_route_node_history ('
        ' id INTEGER PRIMARY KEY AUTOINCREMENT,'
        ' route_id INTEGER NOT NULL,'
        ' operator_id INTEGER,'
        ' source TEXT,'
        ' before_json TEXT,'
        ' after_json TEXT,'
        ' before_count INTEGER NOT NULL DEFAULT 0,'
        ' after_count INTEGER NOT NULL DEFAULT 0,'
        ' created_at DATETIME)'
    ))
    db.commit()
    _ROUTE_HIST_READY = True


def _node_brief(n):
    """节点摘要。兼容 ORM 对象与 dict。"""
    if isinstance(n, dict):
        return {'room_code': n.get('room_code'), 'area_code': n.get('area_code'),
                'snapshot_name': n.get('snapshot_name'), 'node_type': n.get('node_type') or 'room'}
    return {'room_code': getattr(n, 'room_code', None), 'area_code': getattr(n, 'area_code', None),
            'snapshot_name': getattr(n, 'snapshot_name', None),
            'node_type': getattr(n, 'node_type', 'room')}


def update_route(db: Session, route_id: int, payload: Dict[str, Any],
                 operator_id: int = None) -> Optional[Dict[str, Any]]:
    """编辑线路。`nodes` 给了就**全量替换**（前端一次提交整份清单）。

    ⚠️ 2026-10-26 加固：整表替换一旦提交清单不全就会静默丢节点（线上已发生 5 个→1 个）。
      因此：① 原有节点非空时禁止保存空清单；② 原有 ≥3 个而新清单不到一半 → 判疑似误清、直接拒绝
      （要精简请用单删接口逐个删）；③ 每次保存都把改前/改后快照写历史表 + route_edit.log。
    """
    r = db.get(InspectionRoute, route_id)
    if not r:
        return None
    if payload.get("name") is not None:
        r.name = payload["name"]
    if payload.get("description") is not None:
        r.description = payload["description"]
    if payload.get("status") is not None:
        r.status = payload["status"]

    if payload.get("nodes") is not None:
        import json as _json
        import datetime as _dt
        from sqlalchemy import text as _text
        _ensure_route_history(db)
        _before = list(db.execute(
            select(InspectionRouteNode).where(InspectionRouteNode.route_id == route_id)
            .order_by(InspectionRouteNode.seq, InspectionRouteNode.id)
        ).scalars())
        _new = payload["nodes"] or []
        _nb, _nn = len(_before), len(_new)
        _bb = [_node_brief(x) for x in _before]
        _ba = [_node_brief(x) for x in _new]
        _rec = {"ts": _dt.datetime.now().isoformat(timespec="seconds"),
                "route_id": route_id, "operator_id": operator_id,
                "before_count": _nb, "after_count": _nn,
                "before": _bb, "after": _ba}
        if _nb > 0 and _nn == 0:
            _r = dict(_rec); _r["result"] = "blocked_empty"
            _route_edit_log(_r)
            raise ValueError("nodes_empty")
        if _nb >= 3 and _nn * 2 < _nb:
            _r = dict(_rec); _r["result"] = "blocked_shrink"
            _route_edit_log(_r)
            raise ValueError("nodes_shrink:%d:%d" % (_nb, _nn))
        db.execute(_text(
            "insert into inspection_route_node_history "
            "(route_id, operator_id, source, before_json, after_json, before_count, after_count, created_at) "
            "values (:r,:o,:s,:bj,:aj,:bc,:ac,:ts)"),
            {"r": route_id, "o": operator_id, "s": "update_route",
             "bj": _json.dumps(_bb, ensure_ascii=False),
             "aj": _json.dumps(_ba, ensure_ascii=False),
             "bc": _nb, "ac": _nn, "ts": _dt.datetime.now()})
        # 全量替换：先删旧节点，再插新（节点本身无独立业务状态，只有打卡记录引用 node_id）
        db.query(InspectionRouteNode).filter(
            InspectionRouteNode.route_id == route_id
        ).delete(synchronize_session=False)
        for i, nd in enumerate(_new):
            db.add(_build_node(route_id, i, nd))
        _r = dict(_rec); _r["result"] = "saved"
        _route_edit_log(_r)

    db.commit()
    return get_route(db, route_id)


def append_node(db: Session, route_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """追加节点（扫码加节点）。同房间重复加 → 返回 (None, 'duplicate') 交路由转 409。"""
    r = db.get(InspectionRoute, route_id)
    if not r:
        return None
    room_code = (payload.get("room_code") or "").strip() or None
    if (payload.get("node_type") or "room") == "room" and room_code:
        dup = db.execute(
            select(InspectionRouteNode).where(
                InspectionRouteNode.route_id == route_id,
                InspectionRouteNode.room_code == room_code,
            )
        ).scalars().first()
        if dup:
            raise ValueError("dup_room")
    seq = payload.get("seq")
    if seq is None:
        max_seq = db.execute(
            select(func.max(InspectionRouteNode.seq)).where(
                InspectionRouteNode.route_id == route_id
            )
        ).scalar_one()
        seq = (max_seq or 0) + 1
    db.add(_build_node(route_id, seq, payload))
    db.commit()
    return get_route(db, route_id)


def delete_node(db: Session, route_id: int, node_id: int) -> bool:
    node = db.get(InspectionRouteNode, node_id)
    if not node or node.route_id != route_id:
        return False
    db.delete(node)
    db.commit()
    return True


def delete_route(db: Session, route_id: int) -> bool:
    r = db.get(InspectionRoute, route_id)
    if not r:
        return False
    # 级联删节点（打卡记录保留，便于审计「曾在该线路打过卡」）
    db.query(InspectionRouteNode).filter(
        InspectionRouteNode.route_id == route_id
    ).delete(synchronize_session=False)
    db.delete(r)
    db.commit()
    return True


# =====================================================================
# 工单编辑 / 删除（补齐线上缺失的 PUT / DELETE）
# =====================================================================

# 仅这两态可删：未派发出去的单 + 已取消的单（其余有执行痕迹，删了会丢审计）
DELETABLE_STATUSES = frozenset({st.ST_PENDING_DISPATCH, st.ST_CANCELLED})

# 编辑允许的字段（白名单，防止前端传 reporter_id / status 等越权字段）
EDITABLE_FIELDS = (
    "title", "description", "type", "priority", "asset_device_code",
    "room_code", "assignee_id", "due_at",
)


def update_work_order(db: Session, wo_id: int, actor_id: int,
                      payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """编辑工单。返回 (data, err_code)。err_code ∈ {not_found, conflict, invalid_state}。

    版本乐观锁：带 version 且与库内不一致 → 返回 'conflict'（路由转 409），
    version 由前端决定是否递增（这里 +1，与动作端点同语义）。
    """
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        return None, "not_found"
    # 已完成/待验收/关闭的单不允许再编辑执行内容（审计留痕），仅 pending_dispatch/assigned/in_progress 可编
    if wo.status in (st.ST_COMPLETED, st.ST_PENDING_REVIEW, st.ST_CLOSED, st.ST_CANCELLED):
        return None, "invalid_state"

    ver = payload.get("version")
    if ver is not None and int(ver) != int(wo.version or 0):
        return None, "conflict"

    for f in EDITABLE_FIELDS:
        if f in payload and payload[f] is not None:
            setattr(wo, f, payload[f])
    if payload.get("meta") is not None:
        wo.meta = payload["meta"]

    wo.version = int(wo.version or 0) + 1
    wo.updated_at = _utcnow()
    db.commit()
    db.refresh(wo)
    return {c.name: getattr(wo, c.name) for c in WorkOrder.__table__.columns}, None


def delete_work_order(db: Session, wo_id: int) -> Tuple[bool, Optional[str]]:
    """删除工单（仅 pending_dispatch / cancelled）。返回 (ok, err_code)。"""
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        return False, "not_found"
    if wo.status not in DELETABLE_STATUSES:
        return False, "invalid_state"
    db.query(WorkOrderEvent).filter(WorkOrderEvent.work_order_id == wo_id)\
        .delete(synchronize_session=False)
    db.delete(wo)
    db.commit()
    return True, None


# =====================================================================
# 打卡
# =====================================================================

def _route_id_of_wo(wo: WorkOrder) -> Optional[int]:
    rid = _parse_meta(wo.meta).get(ROUTE_META_KEY)
    try:
        return int(rid) if rid is not None else None
    except (TypeError, ValueError):
        return None


def _required_nodes(db: Session, route_id: int) -> List[InspectionRouteNode]:
    """应打卡节点（require_checkin=1）。"""
    return list(
        db.execute(
            select(InspectionRouteNode).where(
                InspectionRouteNode.route_id == route_id,
                InspectionRouteNode.require_checkin.is_(True),
            )
        ).scalars().all()
    )


def _checked_node_ids(db: Session, wo_id: int) -> set:
    rows = db.execute(
        select(InspectionCheckin.node_id).where(
            InspectionCheckin.work_order_id == wo_id
        )
    ).scalars().all()
    return set(rows)


# ==================== 打卡范围（10 米半径） ====================
# 用户需求（2026-10-21）：「打卡范围限定在定位附近 10 米」。
# 基准点取「该节点所在房间的定位观测」（device_geo_observations 里 room_code 匹配、
# 坐标可用的最新一条；人工修正 manual 优先）—— 房间定位就是现场扫码留下的真实坐标，
# 而线路节点本身没有经纬度字段。
CHECKIN_RADIUS_M = 30.0


import json
import logging
import os
import threading

_oor_logger = None
_oor_lock = threading.Lock()


def _get_oor_logger():
    global _oor_logger
    if _oor_logger is None:
        with _oor_lock:
            if _oor_logger is None:
                log_dir = os.path.join(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs"
                )
                os.makedirs(log_dir, exist_ok=True)
                _oor_logger = logging.getLogger("checkin_oor")
                _oor_logger.setLevel(logging.INFO)
                if not _oor_logger.handlers:
                    _h = logging.FileHandler(
                        os.path.join(log_dir, "checkin_oor.log"), encoding="utf-8"
                    )
                    _h.setFormatter(logging.Formatter("%(message)s"))
                    _oor_logger.addHandler(_h)
                    _oor_logger.propagate = False
    return _oor_logger


def _log_oor(wo_id, node_id, operator_id, dist_m, lat, lng, ref, room_code):
    """超范围打卡审计日志：写入结构化 JSON 一行（含工单/节点/操作人/距离/双方坐标/时间）。"""
    rec = {
        "ts": _utcnow().isoformat(),
        "wo_id": wo_id,
        "node_id": node_id,
        "operator_id": operator_id,
        "room_code": room_code,
        "allowed_m": CHECKIN_RADIUS_M,
        "distance_m": round(dist_m, 1),
        "lat": lat,
        "lng": lng,
        "ref_lat": ref[0],
        "ref_lng": ref[1],
    }
    _get_oor_logger().info(json.dumps(rec, ensure_ascii=False))


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """两点球面距离（米）。同为 gcj02 坐标系，做 30 米级判定足够。"""
    r = 6371008.8
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _room_reference_point(db: Session, room_code: str) -> Optional[Tuple[float, float]]:
    """房间定位基准点：优先最新一条人工修正（manual），否则最新一条自动观测。"""
    code = (room_code or "").strip()
    if not code:
        return None
    base = select(DeviceGeoObservation).where(
        DeviceGeoObservation.room_code == code,
        DeviceGeoObservation.latitude.isnot(None),
        DeviceGeoObservation.longitude.isnot(None),
    )
    row = db.execute(
        base.where(DeviceGeoObservation.scan_source == "manual")
        .order_by(DeviceGeoObservation.id.desc()).limit(1)
    ).scalars().first()
    if row is None:
        row = db.execute(
            base.order_by(DeviceGeoObservation.id.desc()).limit(1)
        ).scalars().first()
    if row is None:
        return None
    return float(row.latitude), float(row.longitude)




def _is_finite(x) -> bool:
    try:
        return x is not None and float(x) == float(x) and abs(float(x)) < 1e7
    except (TypeError, ValueError):
        return False


def _seed_room_reference(db: Session, room_code: str, lat: float, lng: float,
                         accuracy: Optional[float], operator_id: int) -> None:
    """首签自动建基准：以本次打卡坐标作为该房间的定位基准点。

    写入 device_geo_observations（device_code 用 ROOM::<code> 哨兵表示「房间级」，
    非某台设备），scan_source='checkin_seed'。后续打卡由 _room_reference_point
    按 room_code 取用（用户在小程序里手动标注的 manual 记录仍优先）。
    """
    obs = DeviceGeoObservation(
        device_code="ROOM::%s" % room_code,
        latitude=lat,
        longitude=lng,
        accuracy=(float(accuracy) if _is_finite(accuracy) else None),
        coord_type="gcj02",
        room_code=room_code,
        scan_source="checkin_seed",
        source="wechat_miniapp",
        operator=str(operator_id),
        observed_at=datetime.now(),
        created_at=datetime.now(),
    )
    db.add(obs)
    db.commit()


def checkin(db: Session, wo_id: int, actor_id: int,
            payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """打卡。返回 (result, err_code)。err_code ∈ {not_found, node_invalid,
    dup, remark_required, invalid_state}。"""
    wo = db.get(WorkOrder, wo_id)
    if not wo:
        return None, "not_found"
    # 终态/未开始不允许打卡：需在 assigned/in_progress
    if wo.status not in (st.ST_ASSIGNED, st.ST_IN_PROGRESS):
        return None, "invalid_state"

    route_id = _route_id_of_wo(wo)
    if not route_id:
        return None, "node_invalid"

    node = db.get(InspectionRouteNode, payload["node_id"])
    if not node or node.route_id != route_id:
        return None, "node_invalid"

    abnormal = bool(payload.get("abnormal"))
    remark = payload.get("remark") or ""
    if abnormal and not remark.strip():
        return None, "remark_required"

    # 幂等：同一工单同一节点只允许一次
    if db.execute(
        select(InspectionCheckin).where(
            InspectionCheckin.work_order_id == wo_id,
            InspectionCheckin.node_id == node.id,
        )
    ).scalars().first():
        return None, "dup"

    # ---- 打卡范围校验（用户需求：定位附近 10 米内才允许打卡）----
    geo_note: Optional[str] = None
    lat, lng = payload.get("lat"), payload.get("lng")
    room_code = (node.room_code or "").strip()
    out_of_range = False
    dist_m = None
    if room_code:
        ref = _room_reference_point(db, room_code)
        if ref is None:
            # 房间还没有定位基准：
            #  - 本次打卡带来有效坐标 → 首签自动以该坐标建房间基准点，之后须在 10 米内打卡；
            #  - 连坐标都没有（室内无信号）→ 放行但不建基准、不校验，避免现场卡死。
            if _is_finite(lat) and _is_finite(lng):
                _seed_room_reference(db, room_code, float(lat), float(lng),
                                     payload.get("accuracy"), actor_id)
                geo_note = f"首次打卡：已以此位置建立该房间定位基准，后续需在 {int(CHECKIN_RADIUS_M)} 米内打卡"
            else:
                geo_note = "未获取到定位，本次未建立基准也未校验打卡范围（请到可获取定位处首次打卡以建立基准）"
        else:
            if lat is None or lng is None:
                return None, "geo_missing"
            dist_m = _haversine_m(float(lat), float(lng), ref[0], ref[1])
            # 超范围判定（产品需求 2026-10-23）：以用户手动获取的坐标为准；
            # 超出设定范围（>30 米）即记为超范围，仍允许正常打卡，但标记+写审计日志+前端提醒。
            out_of_range = dist_m > CHECKIN_RADIUS_M
            if out_of_range:
                _log_oor(wo_id, node.id, actor_id, dist_m, float(lat), float(lng), ref, room_code)
                geo_note = (
                    f"⚠️ 本次打卡位置距目标点 {dist_m:.0f} 米，"
                    f"超出 {int(CHECKIN_RADIUS_M)} 米打卡范围，已记为超范围打卡"
                )

    # ---- 蓝牙信标第二因子（2026-11-18）----
    # 分级：房间未绑标 -> verified=None，只走定位；已绑标 -> 要求三元组匹配且信号达门限。
    # enforce=true 时未命中直接拒绝；false 时放行但标记 gps+beacon_failed（应急降级）。
    bcn = beacon_service.verify_checkin(db, room_code, payload)
    if bcn["verified"] is False and beacon_service.BEACON_ENFORCE:
        return None, "beacon_missed:%s" % (bcn["note"] or "未检测到本房间信标")

    ci = InspectionCheckin(
        work_order_id=wo_id,
        route_id=route_id,
        node_id=node.id,
        operator_id=actor_id,
        checked_at=_utcnow(),
        distance_m=dist_m,
        out_of_range=out_of_range,
        beacon_id=bcn["beacon_id"],
        beacon_rssi=(int(payload.get("beacon_rssi")) if payload.get("beacon_rssi") is not None else None),
        beacon_verified=bcn["verified"],
        beacon_scan_count=payload.get("beacon_scan_count"),
        checkin_mode=bcn["mode"],
        lat=payload.get("lat"),
        lng=payload.get("lng"),
        remark=remark,
        abnormal=abnormal,
    )
    db.add(ci)
    db.commit()
    db.refresh(ci)

    required = _required_nodes(db, route_id)
    done_ids = _checked_node_ids(db, wo_id)
    done_count = sum(1 for n in required if n.id in done_ids)
    total = len(required)
    all_done = total > 0 and done_count >= total

    # 全打完且处于 in_progress → 自动推进到 completed（+1 写事件）
    if all_done and wo.status == st.ST_IN_PROGRESS:
        wo.status = st.ST_COMPLETED
        wo.completed_at = _utcnow()
        wo.version = int(wo.version or 0) + 1
        wo.updated_at = _utcnow()
        db.add(WorkOrderEvent(
            work_order_id=wo_id, event_type=st.EV_COMPLETED,
            from_status=st.ST_IN_PROGRESS, to_status=st.ST_COMPLETED,
            actor_id=actor_id, payload={"auto": True, "reason": "all_nodes_checked"},
        ))
        db.commit()

    out = {c.name: getattr(ci, c.name) for c in InspectionCheckin.__table__.columns}
    return {"ok": True, "checkin": out, "node_total": total,
            "node_done": done_count, "all_done": all_done,
            "message": geo_note, "beacon_verified": bcn["verified"],
            "checkin_mode": bcn["mode"], "beacon_note": bcn["note"]}, None


def list_checkins(db: Session, wo_id: int) -> List[Dict[str, Any]]:
    rows = db.execute(
        select(InspectionCheckin).where(InspectionCheckin.work_order_id == wo_id)
        .order_by(InspectionCheckin.checked_at, InspectionCheckin.id)
    ).scalars().all()
    return [{c.name: getattr(r, c.name) for c in InspectionCheckin.__table__.columns}
            for r in rows]


def wo_nodes_with_checkin(db: Session, wo: WorkOrder) -> List[Dict[str, Any]]:
    """工单详情：线路全部节点 + 每个节点的打卡状态（一次性给前端，省二次请求）。

    判定（对齐产品 2.5 表）：
      - 该 node_id 在 inspection_checkins 有记录 → done（绿）
      - 无记录 且 now > due_at              → pending（红，前端按 overdue 打标）
      - 否则                                  → pending（灰）
    """
    route_id = _route_id_of_wo(wo)
    if not route_id:
        return []
    nodes = list_nodes(db, route_id)
    # 打卡记录按 node_id 索引（同一 node 只可能一条）
    ci_rows = db.execute(
        select(InspectionCheckin).where(InspectionCheckin.work_order_id == wo.id)
    ).scalars().all()
    ci_map = {c.node_id: c for c in ci_rows}

    out = []
    for n in nodes:
        ci = ci_map.get(n.id)
        d = _node_out(n)
        if ci:
            d.update({
                "checkin_status": "done",
                "checked_at": ci.checked_at,
                "operator_id": ci.operator_id,
                "remark": ci.remark,
                "abnormal": ci.abnormal,
                # 信标校验（2026-11-18）：历史打卡小字展示用（需求 §5.3）
                "beacon_verified": ci.beacon_verified,
                "beacon_rssi": ci.beacon_rssi,
                "checkin_mode": ci.checkin_mode,
            })
        else:
            d.update({"checkin_status": "pending", "checked_at": None,
                      "operator_id": None, "remark": None, "abnormal": False})
        out.append(d)
    return out


def wo_progress(db: Session, wo: WorkOrder) -> Tuple[int, int]:
    """(已打卡数, 应打卡总数)。"""
    route_id = _route_id_of_wo(wo)
    if not route_id:
        return 0, 0
    required = _required_nodes(db, route_id)
    done_ids = _checked_node_ids(db, wo.id)
    return sum(1 for n in required if n.id in done_ids), len(required)


# =====================================================================
# 首页统计 GET /stats/patrol
# =====================================================================

def patrol_stats(db: Session) -> Dict[str, Any]:
    """首页「生产数据」三张卡。

    - wo_doing   ：进行中工单 = pending_dispatch + assigned + in_progress
    - wo_overdue ：due_at < now 且非终态（只计数，不改 status）
    - today_checkin_rate：今日应打卡节点数 ÷ 已打卡节点数（%）；无到期 = 100%

    打卡率口径：取「今日已到期的活跃工单」为分母（due_at 在今天内的非终态单），
    统计这些单的节点打卡完成比例；若今日无到期工单 → 100%（无到期=100%）。
    """
    now = _utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start.replace(hour=23, minute=59, second=59, microsecond=999999)

    active = (st.ST_PENDING_DISPATCH, st.ST_ASSIGNED, st.ST_IN_PROGRESS)

    # 进行中（进行中工单卡）
    wo_doing = db.execute(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.status.in_(active))
    ).scalar_one()
    wo_doing_doing = db.execute(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.status == st.ST_IN_PROGRESS)
    ).scalar_one()
    wo_pending = db.execute(
        select(func.count()).select_from(WorkOrder).where(WorkOrder.status == st.ST_PENDING_DISPATCH)
    ).scalar_one()

    # 逾期（不改 status）
    wo_overdue = db.execute(
        select(func.count()).select_from(WorkOrder).where(
            WorkOrder.status.in_(active),
            WorkOrder.due_at.isnot(None),
            WorkOrder.due_at < now,
        )
    ).scalar_one()

    # 今日打卡率：今日到期(deadline 落在今天)的活跃工单，其节点打卡完成比例
    today_wos = db.execute(
        select(WorkOrder).where(
            WorkOrder.status.in_(active),
            WorkOrder.due_at.isnot(None),
            WorkOrder.due_at >= today_start,
            WorkOrder.due_at <= today_end,
        )
    ).scalars().all()

    due_nodes = 0
    checked_today = 0
    for wo in today_wos:
        done, total = wo_progress(db, wo)
        due_nodes += total
        checked_today += done
    rate = round((checked_today / due_nodes) * 100, 1) if due_nodes > 0 else 100.0

    # 已盘点机房数（最新状态口径：只要有 completed/abnormal 记录即算已盘）
    # 用原生 SQL 读 room_inventory_records / rooms（避开 ORM 模型差异，列缺失时返回 0）
    try:
        from sqlalchemy import text as sa_text
        rows_rooms = db.execute(
            sa_text("SELECT count(*) FROM room_inventory_records "
                    "WHERE status IN ('completed','abnormal')")
        ).scalar_one()
        rows_total = db.execute(sa_text("SELECT count(*) FROM rooms")).scalar_one()
    except Exception:
        rows_rooms, rows_total = 0, 0

    return {
        "wo_doing": int(wo_doing),
        "wo_doing_doing": int(wo_doing_doing),
        "wo_pending": int(wo_pending),
        "wo_overdue": int(wo_overdue),
        "today_checkin_rate": rate,
        "today_checked_nodes": checked_today,
        "today_due_nodes": due_nodes,
        "rooms_inventoried": int(rows_rooms),
        "rooms_total": int(rows_total),
    }


def available_nodes(db: Session, node_type: str = "room",
                    q: Optional[str] = None) -> List[Dict[str, Any]]:
    """可选节点清单：全部房间（node_type=room）或区域（area）。

    room 数据源：核心 `rooms` 表（权威），返回 code/name/building/floor，
    供 NodePicker 展示。rooms 表结构与其他模块共用，这里做容错（列缺失返回空）。
    """
    from sqlalchemy import text as sa_text
    out: List[Dict[str, Any]] = []
    if node_type == "room":
        sql = "SELECT code, name, building, floor FROM rooms"
        params: Dict[str, Any] = {}
        if q and q.strip():
            sql += " WHERE name LIKE :kw OR code LIKE :kw"
            params["kw"] = f"%{q.strip()}%"
        sql += " ORDER BY building, floor, name LIMIT 500"
        for r in db.execute(sa_text(sql), params).all():
            out.append({"room_code": r[0], "snapshot_name": r[1] or "",
                        "building": r[2] or "", "floor": r[3] or ""})
    else:
        # 区域节点：这里以楼栋聚合近似（区域树由 /assets/trees/area 提供，
        # 巡查侧只需一个轻量候选清单）
        sql = "SELECT DISTINCT building FROM rooms WHERE building IS NOT NULL AND building != ''"
        for r in db.execute(sa_text(sql)).all():
            if r[0]:
                out.append({"area_code": r[0], "snapshot_name": r[0]})
    return out
