"""运维执行域 · 数据访问层（仓储）。

分层纪律（Spec 目录规范）
------------------------
- 本层**只做数据访问**：查询封装、插入、分页。**不含**业务规则、不做权限判定、
  不抛 HTTP 语义异常。
- 事务提交点由 service 层控制（本层不 commit，除显式声明的 `put_receipt`）。
- 事件表 `work_order_events` 只提供 `insert` / `list` / `get` —— 无 UPDATE / DELETE，
  从仓储层面即保证不可变（C6）。
"""
from datetime import date, datetime, time, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from work_order_models import SyncReceipt, WorkOrder, WorkOrderEvent

# ==================== 列表查询：白名单与常量 ====================

# 排序字段 / 方向白名单（路由层用 Literal 校验；此处仅作仓储层防御）
SORT_FIELDS: Tuple[str, ...] = ("created_at", "due_at", "priority")
ORDER_DIRECTIONS: Tuple[str, ...] = ("asc", "desc")
# 优先级语义序（**禁止字典序**：字典序下 high < low < medium < urgent 是错的）
PRIORITY_RANK: Dict[str, int] = {"low": 0, "medium": 1, "high": 2, "urgent": 3}
# 关键字长度上限：超出**截断**（不报错）。理由：搜索框粘贴超长文本不应因一个长度
# 限制就把整页打回 400；截断同时避免超长 LIKE 模式拖慢全表扫描。
Q_MAX_LEN: int = 100


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _like_pattern(text: str) -> str:
    """构造 LIKE 模式：转义 `\\` `%` `_`，使用户输入的 `%` 是**字面量**而非通配符。

    不转义时 `q=%` 会退化成「匹配全表」，是典型的静默错误。
    """
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _order_by(sort: str, order: str) -> List[Any]:
    """列表排序子句（排序铁律见 `list_work_orders` docstring）。

    任何规则末尾都追加 `id DESC` 作稳定 tiebreaker —— 否则同值行在分页时会重复/丢行。
    """
    if order not in ORDER_DIRECTIONS:
        raise ValueError(f"非法 order：{order}")
    desc = order == "desc"

    if sort == "due_at":
        # 空值恒排最后（asc / desc 均排最后）：先按 (due_at IS NULL) 升序（False<True），
        # 再按 due_at 方向。用 CASE 显式表达 `(due_at IS NULL)`，避免语法歧义。
        null_rank = case((WorkOrder.due_at.is_(None), 1), else_=0)
        clauses = [null_rank.asc(),
                   WorkOrder.due_at.desc() if desc else WorkOrder.due_at.asc()]
    elif sort == "priority":
        # 语义序 low < medium < high < urgent（禁止字典序）
        rank = case(PRIORITY_RANK, value=WorkOrder.priority, else_=-1)
        clauses = [rank.desc() if desc else rank.asc()]
    elif sort == "created_at":
        clauses = [WorkOrder.created_at.desc() if desc else WorkOrder.created_at.asc()]
    else:
        raise ValueError(f"非法 sort：{sort}")

    clauses.append(WorkOrder.id.desc())
    return clauses


# ==================== 单据编号 ====================

def next_daily_code(db: Session, prefix: str) -> str:
    """生成 `<prefix>-YYYYMMDD-NNNN`（当日流水，零填充 4 位）。

    SQLite 单写者场景下够用；编号只是**人读标识**，唯一性由 `code` 唯一索引兜底
    （极端并发撞号会触发唯一约束，由 service 重试一次）。
    """
    day = _utcnow().strftime("%Y%m%d")
    like = f"{prefix}-{day}-%"
    last = (db.query(WorkOrder.code).filter(WorkOrder.code.like(like))
            .order_by(WorkOrder.code.desc()).first())
    seq = 1
    if last and last[0]:
        try:
            seq = int(str(last[0]).rsplit("-", 1)[1]) + 1
        except (ValueError, IndexError):
            seq = 1
    return f"{prefix}-{day}-{seq:04d}"


# ==================== 工单 ====================

def get_work_order(db: Session, wo_id: int) -> Optional[WorkOrder]:
    return db.query(WorkOrder).filter(WorkOrder.id == wo_id).first()


def find_work_order_by_code(db: Session, code: str) -> Optional[WorkOrder]:
    return db.query(WorkOrder).filter(WorkOrder.code == code).first()


def list_work_orders(db: Session, *, status: Optional[str] = None,
                     wo_type: Optional[str] = None,
                     assignee_id: Optional[int] = None,
                     reporter_id: Optional[int] = None,
                     room_code: Optional[str] = None,
                     asset_device_code: Optional[str] = None,
                     q: Optional[str] = None,
                     priority: Optional[str] = None,
                     due_from: Optional[date] = None,
                     due_to: Optional[date] = None,
                     sort: str = "created_at", order: str = "desc",
                     page: int = 1, page_size: int = 20) -> Tuple[List[WorkOrder], int]:
    """过滤 + 排序 + 分页（契约 GET /work-orders）。additive 参数，老调用零影响。

    - `q`：模糊关键字，命中 `code` / `title` / `description` / `asset_device_code` /
      `room_code` **任一**即算命中。大小写不敏感（SQLite 的 LIKE 对 ASCII 天然如此）。
      `%` `_` 已转义为字面量；超过 `Q_MAX_LEN`(100) **截断**（见常量处理由）。
    - `priority`：精确等值（low/medium/high/urgent，取值由路由层 Literal 校验）。
    - `due_from` / `due_to`：按日期**闭区间** —— `due_from=D` 从 D 00:00:00 起、
      `due_to=D` 到 D 23:59:59.999999 止。**`due_at IS NULL` 的行不参与区间命中**，
      这是 SQL 对 NULL 比较的自然结果，也是**有意为之**（无截止时间的单不应落进区间），
      勿误判为 bug。
    - `sort` ∈ created_at/due_at/priority（默认 created_at），`order` ∈ asc/desc（默认 desc）。
      非法取值由路由层拦成 400/40000，**绝不静默忽略或回退**；此处仅作防御性 `ValueError`。
    - 排序铁律见 `_order_by`。**不传新参数时行为与历史逐字节一致**：`created_at DESC, id DESC`。
    - `total` 恒为**过滤后**总数，与分页无关。
    """
    query = db.query(WorkOrder)
    if status:
        query = query.filter(WorkOrder.status == status)
    if wo_type:
        query = query.filter(WorkOrder.type == wo_type)
    if assignee_id is not None:
        query = query.filter(WorkOrder.assignee_id == assignee_id)
    if reporter_id is not None:
        query = query.filter(WorkOrder.reporter_id == reporter_id)
    if room_code:
        query = query.filter(WorkOrder.room_code == room_code)
    if asset_device_code:
        query = query.filter(WorkOrder.asset_device_code == asset_device_code)

    if q and q.strip():
        pattern = _like_pattern(q.strip()[:Q_MAX_LEN])
        query = query.filter(
            WorkOrder.code.like(pattern, escape="\\")
            | WorkOrder.title.like(pattern, escape="\\")
            | WorkOrder.description.like(pattern, escape="\\")
            | WorkOrder.asset_device_code.like(pattern, escape="\\")
            | WorkOrder.room_code.like(pattern, escape="\\")
        )
    if priority:
        query = query.filter(WorkOrder.priority == priority)
    if due_from is not None:
        query = query.filter(WorkOrder.due_at >= datetime.combine(due_from, time.min))
    if due_to is not None:
        query = query.filter(WorkOrder.due_at <= datetime.combine(due_to, time.max))

    total = query.count()
    rows = (query.order_by(*_order_by(sort, order))
            .offset((page - 1) * page_size).limit(page_size).all())
    return rows, int(total)


def add_work_order(db: Session, **fields: Any) -> WorkOrder:
    wo = WorkOrder(**fields)
    db.add(wo)
    return wo


# ==================== 事件（只增） ====================

def insert_event(db: Session, *, work_order_id: int, event_type: str,
                 from_status: Optional[str], to_status: Optional[str],
                 actor_id: int, payload: Optional[Dict[str, Any]] = None,
                 client_op_id: Optional[str] = None) -> WorkOrderEvent:
    """写入一条审计事件。**本模块不提供修改/删除入口**（C6 不可变）。"""
    ev = WorkOrderEvent(
        work_order_id=work_order_id,
        event_type=event_type,
        from_status=from_status,
        to_status=to_status,
        actor_id=actor_id if actor_id is not None else 0,
        payload=payload or {},
        client_op_id=client_op_id,
    )
    db.add(ev)
    return ev


def list_events(db: Session, wo_id: int) -> List[WorkOrderEvent]:
    """按 created_at 升序（契约：事件时间线）。"""
    return (db.query(WorkOrderEvent)
            .filter(WorkOrderEvent.work_order_id == wo_id)
            .order_by(WorkOrderEvent.created_at.asc(), WorkOrderEvent.id.asc())
            .all())


def count_events(db: Session, wo_id: int) -> int:
    return int(db.query(func.count(WorkOrderEvent.id))
               .filter(WorkOrderEvent.work_order_id == wo_id).scalar() or 0)


# ==================== 离线收据（幂等） ====================

def get_receipt(db: Session, client_op_id: str) -> Optional[SyncReceipt]:
    return (db.query(SyncReceipt)
            .filter(SyncReceipt.client_op_id == client_op_id).first())


def put_receipt(db: Session, client_op_id: str, result: Dict[str, Any],
                server_id: Optional[int] = None) -> SyncReceipt:
    """落一条已受理收据。**只对 accepted 操作调用**（conflict/error 不落，保证可重试）。"""
    rec = SyncReceipt(client_op_id=client_op_id, result=result, server_id=server_id)
    db.add(rec)
    db.flush()
    return rec
