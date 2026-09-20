"""工单状态机 —— 枚举 + 转换表（Spec §5 / OpenAPI §0.2）。

主链：`pending_dispatch` → `assigned` → `in_progress` → `completed` → `pending_review` → `closed`
旁路：任意活跃态 → `cancelled`；`cancelled`/`closed` 经 `reopen` 动作回到 `assigned` | `in_progress`

关键约定（易错点，别改）
------------------------
- **无 `draft` 态**：create 直接落 `pending_dispatch`（设计师 D1 与 PRD §2.3 一致性校验结论）。
- **`reopened` 是动作不是状态**：重开不新增状态，写 `reopened` 事件 + `parent_id` 指向原单。
- **`review` 是分叉动作**：approve → `closed`（写 `closed_at`）；reject → `in_progress`（打回重做）。
- 转换表是**唯一**合法性判据；服务层不得旁路判断（C6）。
"""
from typing import Dict, FrozenSet, Optional, Tuple

# ==================== 状态 ====================

ST_PENDING_DISPATCH = "pending_dispatch"
ST_ASSIGNED = "assigned"
ST_IN_PROGRESS = "in_progress"
ST_COMPLETED = "completed"
ST_PENDING_REVIEW = "pending_review"
ST_CLOSED = "closed"
ST_CANCELLED = "cancelled"

STATUSES: Tuple[str, ...] = (
    ST_PENDING_DISPATCH, ST_ASSIGNED, ST_IN_PROGRESS,
    ST_COMPLETED, ST_PENDING_REVIEW, ST_CLOSED, ST_CANCELLED,
)

# 活跃态 = 可被 cancel 的状态集合（closed / cancelled 为终态）
ACTIVE_STATUSES: FrozenSet[str] = frozenset({
    ST_PENDING_DISPATCH, ST_ASSIGNED, ST_IN_PROGRESS, ST_COMPLETED, ST_PENDING_REVIEW,
})
TERMINAL_STATUSES: FrozenSet[str] = frozenset({ST_CLOSED, ST_CANCELLED})

STATUS_LABELS: Dict[str, str] = {
    ST_PENDING_DISPATCH: "待派",
    ST_ASSIGNED: "已派",
    ST_IN_PROGRESS: "处理中",
    ST_COMPLETED: "已完成",
    ST_PENDING_REVIEW: "待验收",
    ST_CLOSED: "关闭",
    ST_CANCELLED: "已取消",
}

# ==================== 类型 / 优先级 / 来源 ====================

TYPES: Tuple[str, ...] = ("preventive", "corrective", "other")
TYPE_PREVENTIVE = "preventive"
TYPE_CORRECTIVE = "corrective"

PRIORITIES: Tuple[str, ...] = ("low", "medium", "high", "urgent")
SOURCES: Tuple[str, ...] = ("web", "miniprogram", "iot_alert", "import")

# ==================== 事件类型（14 类，契约 WorkOrderEventType） ====================

EV_CREATED = "created"
EV_DISPATCHED = "dispatched"
EV_STARTED = "started"
EV_COMPLETED = "completed"
EV_SUBMITTED_REVIEW = "submitted_review"
EV_REVIEWED_APPROVED = "reviewed_approved"
EV_REVIEWED_REJECTED = "reviewed_rejected"
EV_CLOSED = "closed"
EV_CANCELLED = "cancelled"
EV_REOPENED = "reopened"
EV_CLOSED = "closed"
EV_COMMENT_ADDED = "comment_added"
EV_FIELD_CHANGED = "field_changed"
EV_SYNC_CONFLICT = "sync_conflict"
EV_SPARE_CONSUMED = "spare_consumed"

EVENT_TYPES: Tuple[str, ...] = (
    EV_CREATED, EV_DISPATCHED, EV_STARTED, EV_COMPLETED, EV_SUBMITTED_REVIEW,
    EV_REVIEWED_APPROVED, EV_REVIEWED_REJECTED, EV_CLOSED, EV_CANCELLED,
    EV_REOPENED, EV_COMMENT_ADDED, EV_FIELD_CHANGED, EV_SYNC_CONFLICT,
    EV_SPARE_CONSUMED,
)

# ==================== 动作 → 转换 + 权限位 ====================

# 动作名（对客户端）与权限位、来源态集合、目标态、写入的事件类型。
# 说明：`review` 拆成 approve / reject 两条分支，故用 "from" 集合 + 动态 to。
ACTIONS: Dict[str, Dict] = {
    "dispatch": {
        "from": frozenset({ST_PENDING_DISPATCH}),
        "to": ST_ASSIGNED,
        "permission": "wo.dispatch",
        "event": EV_DISPATCHED,
    },
    "start": {
        "from": frozenset({ST_ASSIGNED}),
        "to": ST_IN_PROGRESS,
        "permission": "wo.execute",
        "event": EV_STARTED,
        "self_only": True,          # 限本人为 assignee（AC-04）
    },
    "complete": {
        "from": frozenset({ST_IN_PROGRESS}),
        "to": ST_COMPLETED,
        "permission": "wo.execute",
        "event": EV_COMPLETED,
    },
    "submit_review": {
        "from": frozenset({ST_COMPLETED}),
        "to": ST_PENDING_REVIEW,
        "permission": "wo.execute",
        "event": EV_SUBMITTED_REVIEW,
    },
    "review_approve": {
        "from": frozenset({ST_PENDING_REVIEW}),
        "to": ST_CLOSED,
        "permission": "wo.review",
        "event": EV_REVIEWED_APPROVED,
    },
    "review_reject": {
        "from": frozenset({ST_PENDING_REVIEW}),
        "to": ST_IN_PROGRESS,
        "permission": "wo.review",
        "event": EV_REVIEWED_REJECTED,
    },
    "cancel": {
        "from": ACTIVE_STATUSES,
        "to": ST_CANCELLED,
        "permission": "wo.cancel",
        "event": EV_CANCELLED,
    },
}

# reopen 是动作而非状态：允许的源态与目标态单独声明
REOPEN_FROM: FrozenSet[str] = frozenset({ST_CANCELLED, ST_CLOSED})
REOPEN_TARGETS: Tuple[str, ...] = (ST_ASSIGNED, ST_IN_PROGRESS)

# 外部动作名（/sync 的 PendingOp.action 与 REST 路径段共用）
EXTERNAL_ACTIONS: Tuple[str, ...] = (
    "dispatch", "start", "complete", "submit_review", "review", "cancel", "reopen",
)


def is_valid_status(status: Optional[str]) -> bool:
    return status in STATUSES


def can_apply(action: str, current_status: str,
              approved: Optional[bool] = None) -> Tuple[bool, Optional[str]]:
    """转换合法性判定。

    返回 `(是否允许, 目标状态)`。不合法时目标状态为 None —— 由服务层转成
    422 / 42200（状态机非法迁移）。
    """
    if action == "review":
        if approved is None:
            return False, None
        action = "review_approve" if approved else "review_reject"
    if action == "reopen":
        if current_status in REOPEN_FROM:
            return True, None          # 目标态由调用方在 REOPEN_TARGETS 中指定
        return False, None
    spec = ACTIONS.get(action)
    if not spec:
        return False, None
    if current_status not in spec["from"]:
        return False, None
    return True, spec["to"]


def action_meta(action: str) -> Optional[Dict]:
    """动作元信息（权限位 / 事件类型 / 目标态）。`review` 由调用方先归一。"""
    return ACTIONS.get(action)


def review_action_name(approved: bool) -> str:
    return "review_approve" if approved else "review_reject"
