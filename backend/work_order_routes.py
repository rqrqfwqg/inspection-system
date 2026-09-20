"""运维执行域 · 路由层（`/work-orders*` 与 `/attachments/upload`）。

职责边界：路由只做「挂依赖 → 取当前用户 → 调 service → 组装响应」，
**不写业务逻辑**、不直连数据库（分层硬门禁）。

认证 / 权限位（契约 §0 与 §0.2）
-------------------------------
- 读接口（列表 / 详情 / 事件）与离线同步、附件上传：**登录即可**（`get_current_user`）。
- 写接口（建单 / 动作）：建单 `wo.create`；dispatch `wo.dispatch`；
  start / complete / submit-review `wo.execute`；review / reopen `wo.review`；
  cancel `wo.cancel`。不足 → 403 / 40300。
- `/sync` 端点本身只要登录；**每一条 op 内部**再按动作校验权限位，
  不足该条返 error，不影响其余条目。
"""
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from attachment_service import save_attachment
from database import get_db, User
from dependencies import get_current_user
from ops_errors import bad_request
from ops_rbac import (
    PERM_CANCEL, PERM_CREATE, PERM_DISPATCH, PERM_EXECUTE, PERM_REVIEW,
    require_permission,
)
from work_order_schemas import (
    AttachmentUploadResponse, CancelRequest, CompleteRequest, DispatchRequest,
    ReopenRequest, ReviewRequest, StartRequest, SubmitReviewRequest, SyncRequest,
    SyncResponse, WorkOrder, WorkOrderCreate, WorkOrderDetail, WorkOrderEvent,
    WorkOrderPage,
)
from work_order_service import apply_action, create_work_order, get_detail, list_page
from work_order_sync_service import sync_ops

router = APIRouter(tags=["work-orders"])

# 读接口 = 登录即可（reviewer 没有 wo.create，不能用它当「读」的门）
_login = Depends(get_current_user)


# ==================== 工单 CRUD ====================

@router.post("/work-orders", response_model=WorkOrder, status_code=201,
             summary="创建工单（→ pending_dispatch）")
def create(payload: WorkOrderCreate,
           db: Session = Depends(get_db),
           actor: User = Depends(require_permission(PERM_CREATE))):
    return create_work_order(db, actor, payload.model_dump())


@router.get("/work-orders", response_model=WorkOrderPage,
            summary="工单列表（过滤 + 排序 + 分页）")
def list_items(status: Optional[Literal["pending_dispatch", "assigned", "in_progress",
                                        "completed", "pending_review", "closed",
                                        "cancelled"]] = None,
               type: Optional[Literal["preventive", "corrective", "other"]] = None,
               assignee_id: Optional[int] = None, room_code: Optional[str] = None,
               asset_device_code: Optional[str] = None,
               q: Optional[str] = None,
               priority: Optional[Literal["low", "medium", "high", "urgent"]] = None,
               due_from: Optional[date] = None, due_to: Optional[date] = None,
               sort: Literal["created_at", "due_at", "priority"] = "created_at",
               order: Literal["asc", "desc"] = "desc",
               page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=200),
               db: Session = Depends(get_db),
               _: User = _login):
    # 查询参数名 `type` 与内置同名，显式映射到仓储的 wo_type；其余参数原样透传。
    # 枚举/日期/数值边界由 FastAPI 依据 Literal / date / Query(ge,le) 校验：非法值
    # → 400 / 40000（绝不静默忽略或回退，避免前端「假筛选」这类「静默算错」：
    #   · status/type 曾是裸 str，传错值返回 200 + total=0，像「真的没数据」；
    #   · sort/order/priority 曾静默忽略或回退；
    #   · page_size 超上限曾一次拉全表、=0 曾返回「空列表 + 正常 total」、page<=0 曾 offset 为负。
    # 合法取值下行为逐字节不变；过滤与排序全部落在仓储层。
    return list_page(db, status=status, wo_type=type, assignee_id=assignee_id,
                     room_code=room_code, asset_device_code=asset_device_code,
                     q=q, priority=priority, due_from=due_from, due_to=due_to,
                     sort=sort, order=order, page=page, page_size=page_size)


# 注意：`/work-orders/sync` 必须先于 `/work-orders/{wo_id}` 注册，
# 避免 "sync" 被当成 id 解析（Spec §7 路由顺序硬约束的同源要求）。
@router.post("/work-orders/sync", response_model=SyncResponse,
             summary="离线批量同步（幂等 + 乐观锁冲突合并）")
def sync(payload: SyncRequest, db: Session = Depends(get_db),
         actor: User = _login):
    return sync_ops(db, actor, payload.ops)


@router.get("/work-orders/{wo_id}", response_model=WorkOrderDetail, summary="工单详情")
def detail(wo_id: int, include_events: bool = True,
           db: Session = Depends(get_db), _: User = _login):
    return get_detail(db, wo_id, include_events=include_events)


@router.get("/work-orders/{wo_id}/events", response_model=list[WorkOrderEvent],
            summary="工单审计事件时间线")
def events(wo_id: int, db: Session = Depends(get_db), _: User = _login):
    return get_detail(db, wo_id, include_events=True)["events"]


# ==================== 动作端点 ====================

@router.post("/work-orders/{wo_id}/dispatch", response_model=WorkOrder,
             summary="派单（pending_dispatch → assigned）")
def dispatch(wo_id: int, payload: DispatchRequest,
             db: Session = Depends(get_db),
             actor: User = Depends(require_permission(PERM_DISPATCH))):
    return apply_action(db, actor, wo_id, "dispatch", payload=payload.model_dump(),
                        expected_version=payload.version)


@router.post("/work-orders/{wo_id}/start", response_model=WorkOrder,
             summary="开始处理（assigned → in_progress，限本人）")
def start(wo_id: int, payload: Optional[StartRequest] = None,
          db: Session = Depends(get_db),
          actor: User = Depends(require_permission(PERM_EXECUTE))):
    return apply_action(db, actor, wo_id, "start",
                        payload=(payload.model_dump() if payload else {}),
                        expected_version=payload.version if payload else None)


@router.post("/work-orders/{wo_id}/complete", response_model=WorkOrder,
             summary="执行完成（in_progress → completed）")
def complete(wo_id: int, payload: Optional[CompleteRequest] = None,
             db: Session = Depends(get_db),
             actor: User = Depends(require_permission(PERM_EXECUTE))):
    return apply_action(db, actor, wo_id, "complete",
                        payload=(payload.model_dump() if payload else {}),
                        expected_version=payload.version if payload else None)


@router.post("/work-orders/{wo_id}/submit-review", response_model=WorkOrder,
             summary="提交验收（completed → pending_review）")
def submit_review(wo_id: int, payload: Optional[SubmitReviewRequest] = None,
                  db: Session = Depends(get_db),
                  actor: User = Depends(require_permission(PERM_EXECUTE))):
    return apply_action(db, actor, wo_id, "submit_review",
                        payload=(payload.model_dump() if payload else {}),
                        expected_version=payload.version if payload else None)


@router.post("/work-orders/{wo_id}/review", response_model=WorkOrder,
             summary="验收（approve→closed / reject→in_progress）")
def review(wo_id: int, payload: ReviewRequest,
           db: Session = Depends(get_db),
           actor: User = Depends(require_permission(PERM_REVIEW))):
    return apply_action(db, actor, wo_id, "review", approved=payload.approved,
                        payload={"note": payload.note, "approved": payload.approved},
                        expected_version=payload.version)


@router.post("/work-orders/{wo_id}/cancel", response_model=WorkOrder,
             summary="取消（任意活跃态 → cancelled，必带原因）")
def cancel(wo_id: int, payload: CancelRequest,
           db: Session = Depends(get_db),
           actor: User = Depends(require_permission(PERM_CANCEL))):
    return apply_action(db, actor, wo_id, "cancel", payload=payload.model_dump(),
                        expected_version=payload.version)


@router.post("/work-orders/{wo_id}/reopen", response_model=WorkOrder,
             summary="重开（cancelled/closed → 新单，parent_id 指向原单）")
def reopen(wo_id: int, payload: ReopenRequest,
           db: Session = Depends(get_db),
           actor: User = Depends(require_permission(PERM_REVIEW))):
    return apply_action(db, actor, wo_id, "reopen", target_status=payload.target_status,
                        payload={"note": payload.note}, expected_version=payload.version)


# ==================== 附件上传 ====================

@router.post("/attachments/upload", response_model=AttachmentUploadResponse,
             status_code=201, summary="上传附件（离线补传先传图再发单）")
async def upload_attachment(file: UploadFile = File(...),
                            client_op_id: Optional[str] = Form(None),
                            db: Session = Depends(get_db), _: User = _login):
    if not file or not file.filename:
        raise bad_request("file 不能为空")
    content = await file.read()
    return save_attachment(db, content=content, filename=file.filename,
                           content_type=file.content_type, client_op_id=client_op_id)
