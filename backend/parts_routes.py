"""备件联邦 · Phase A（只读镜像，外部契约 tools-management）。

契约（OpenAPI spare-parts-federation）
--------------------------------------
| Method | Path | 说明 |
|--------|------|------|
| GET | /ops/api/parts | 备件/工器具目录（只读镜像） |
| GET | /ops/api/inventory | 备件库存（只读镜像，可按 part_code 过滤） |
| POST | /ops/api/inventory/consume | **Phase B 二期**能力，一期占位不启用（501） |

关键纪律
--------
- **单向只读**：本系统只读这三张镜像表 / 桥接表，**绝不回写** tools-management；
  Phase B 才谈「工单关闭时调用扣减 + 退避重试 + 按 ref 对账」。
- `consume` 一期**必须不可用**：直接返 501 / 50100，避免前端误以为扣减已生效
  而出现「显示已领用、实际未扣库存」的静默错误（最致命的一类失效）。
- **仅挂 /ops/api/...**（本项目「业务接口统一收口 /ops/api」的命名空间硬约束）。
  同域 `/api/*` 由 nginx 反代到 tools-management，后端**不挂** `/api` 前缀，避免契约污染；
  外部 tools-management 的原始契约路径 `/api/parts` 等仅在反代层出现，本服务不暴露。
"""
from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db, User
from dependencies import get_current_user
from ops_errors import not_implemented
from work_order_models import SparePartCatalog, SparePartInventory
from work_order_schemas import InventoryItem, Part

router = APIRouter(tags=["spare-parts-federation"])

_login = Depends(get_current_user)


@router.get("/parts", response_model=List[Part],
            summary="备件/工器具目录（只读镜像）")
def get_parts(db: Session = Depends(get_db), _: User = _login):
    rows = db.query(SparePartCatalog).order_by(SparePartCatalog.part_code.asc()).all()
    return [{"part_code": r.part_code, "name": r.name, "spec": r.spec, "unit": r.unit,
             "category": r.category, "safety_flag": bool(r.safety_flag)} for r in rows]


@router.get("/inventory", response_model=List[InventoryItem],
            summary="备件库存（只读镜像）")
def get_inventory(part_code: Optional[str] = None,
                  db: Session = Depends(get_db), _: User = _login):
    q = db.query(SparePartInventory)
    if part_code:
        q = q.filter(SparePartInventory.part_code == part_code.strip())
    rows = q.order_by(SparePartInventory.part_code.asc()).all()
    return [{"part_code": r.part_code, "qty": float(r.qty or 0.0),
             "location": r.location, "last_synced_at": r.last_synced_at} for r in rows]


@router.post("/inventory/consume", summary="领用扣减（Phase B 二期，一期占位不启用）")
def consume_inventory():
    """一期占位：明确返回 501，不静默成功、不假装扣减。"""
    raise not_implemented(
        "备件领用扣减（/ops/api/inventory/consume）为 Phase B 二期能力，"
        "依赖 tools-management 实际 API 面确认；一期只读镜像，不启用回写")
