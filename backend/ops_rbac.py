"""运维执行域 · 角色与权限位（Phase 0 细粒度 RBAC）。

角色（Spec §5 / PRD §1）
------------------------
`reporter` 报修人 / `dispatcher` 值班调度 / `executor` 一线执行人 /
`reviewer` 验收人（班组长与主管）/ `admin` 系统管理员。

权限位（Spec §5 动作表右列）
---------------------------
`wo.create` / `wo.dispatch` / `wo.execute` / `wo.review` / `wo.cancel`。

纪律
----
1. **判定唯一入口** = `require_permission(bit)`；动作端点逐位校验，不足返 403（code 40300）。
2. `role` 列是**既有** `users.role`（默认 `"user"`）。未映射的存量角色按最小权限处理
   （可建单、不可派单/执行/验收/取消），不做静默提权；`ROLE_ALIASES` 只登记已确认等价项。
3. 免鉴权模式（`AUTH_DISABLED=true`）下 `get_current_user` 返回 admin → 天然全权限位，
   与内网开放口径一致；关闭 `DISABLE_AUTH` 后，权限判定立即对所有写操作生效（AC-09）。
4. 本模块不读数据库、不碰资产核心逻辑。
"""
from typing import Callable, Dict, FrozenSet

from fastapi import Depends

from dependencies import get_current_user
from database import User
from ops_errors import forbidden

# ==================== 权限位 ====================

PERM_CREATE = "wo.create"
PERM_DISPATCH = "wo.dispatch"
PERM_EXECUTE = "wo.execute"
PERM_REVIEW = "wo.review"
PERM_CANCEL = "wo.cancel"

ALL_PERMISSIONS: FrozenSet[str] = frozenset({
    PERM_CREATE, PERM_DISPATCH, PERM_EXECUTE, PERM_REVIEW, PERM_CANCEL,
})

# ==================== 角色 → 权限集合 ====================

ROLE_REPORTER = "reporter"
ROLE_DISPATCHER = "dispatcher"
ROLE_EXECUTOR = "executor"
ROLE_REVIEWER = "reviewer"
ROLE_ADMIN = "admin"

ROLE_PERMISSIONS: Dict[str, FrozenSet[str]] = {
    # 报修人：只能建单，看不到别人的执行/验收动作
    ROLE_REPORTER: frozenset({PERM_CREATE}),
    # 值班调度：建单 + 派单 + 取消（不执行、不验收，职责分离）
    ROLE_DISPATCHER: frozenset({PERM_CREATE, PERM_DISPATCH, PERM_CANCEL}),
    # 一线执行人：建单 + 执行（开始/完成/提交验收）
    ROLE_EXECUTOR: frozenset({PERM_CREATE, PERM_EXECUTE}),
    # 验收人：验收 + 取消（复审打回与重开）
    ROLE_REVIEWER: frozenset({PERM_REVIEW, PERM_CANCEL}),
    # 系统管理员：全权限位
    ROLE_ADMIN: ALL_PERMISSIONS,
}

# 存量角色的确认等价项（`users.role` 历史取值）。未列出的角色 → 最小权限，不推断。
ROLE_ALIASES: Dict[str, str] = {
    "": ROLE_REPORTER,
    "user": ROLE_REPORTER,          # 既有默认角色
    "manager": ROLE_DISPATCHER,     # 部门负责人 = 值班调度职责
    "worker": ROLE_EXECUTOR,        # 现场作业人员
    "operator": ROLE_EXECUTOR,
    "supervisor": ROLE_REVIEWER,    # 班组长 / 主管
}

# 未映射角色回退权限：最小可写集合（仅建单）
FALLBACK_PERMISSIONS: FrozenSet[str] = frozenset({PERM_CREATE})


def normalize_role(role: str) -> str:
    """把库里的 role 文本归一为五个权威角色之一。"""
    r = (role or "").strip().lower()
    if r in ROLE_PERMISSIONS:
        return r
    return ROLE_ALIASES.get(r, r)


def permissions_for(role: str) -> FrozenSet[str]:
    """角色 → 权限位集合；未映射角色走最小权限（不静默提权）。"""
    return ROLE_PERMISSIONS.get(normalize_role(role), FALLBACK_PERMISSIONS)


def has_permission(user: User, permission: str) -> bool:
    """权限位判定。admin 恒真（避免映射漂移导致管理员被锁死）。"""
    if user is None:
        return False
    if normalize_role(user.role) == ROLE_ADMIN:
        return True
    return permission in permissions_for(user.role)


def require_permission(permission: str) -> Callable:
    """FastAPI 依赖工厂：`Depends(require_permission("wo.dispatch"))`。

    复用既有 `get_current_user`（401 由它抛），此处只判权限位不足 → 403 / 40300。
    """
    if permission not in ALL_PERMISSIONS:
        raise ValueError(f"未登记的权限位：{permission}")

    def _dependency(current_user: User = Depends(get_current_user)) -> User:
        if not has_permission(current_user, permission):
            raise forbidden(
                f"当前角色 {normalize_role(current_user.role) or 'unknown'} "
                f"缺少权限位 {permission}")
        return current_user

    return _dependency
