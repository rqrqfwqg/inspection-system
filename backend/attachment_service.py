"""附件上传服务（工单现场照片 / 离线补传）。

设计要点
--------
- **先传图，再发单**：离线队列里的照片在同步前先经 `POST /ops/api/attachments/upload`
  拿到远端 URL，成功后把 URL 写进 `wo_create` / `wo_update` 的 `payload.photos`
  （契约 §4）。这样服务端永远只见到已落地的 URL，不需要处理二段提交。
- **幂等**：带 `client_op_id` 时复用 `sync_receipts`（`client_op_id` 为 PK），
  重试同一张图直接回放既有 URL —— 不产生重复文件、不重复占空间。
- **落点**：`backend/uploads/attachments/`，对外 URL 走既有命名空间
  `/ops/uploads/attachments/<name>`（`main.py` 已把 `uploads/` 挂到 `/ops/uploads`）。
- **仅图片**：按 content-type 与扩展名双重白名单；类型不符 → 400 / 40000。
"""
import os
import uuid
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from ops_errors import ApiError, bad_request
from work_order_repository import get_receipt, put_receipt

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ATTACHMENT_DIR = os.path.join(BASE_DIR, "uploads", "attachments")
ATTACHMENT_URL_PREFIX = "/ops/uploads/attachments"

# 单文件上限 10MB（现场照片，与设备照片口径一致）
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

# content-type → 扩展名（白名单；扩展名以 content-type 为准，避免客户端乱传 .php）
_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}
_ALLOWED_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp")


def _ensure_dir() -> None:
    os.makedirs(ATTACHMENT_DIR, exist_ok=True)


def _resolve_ext(filename: str, content_type: Optional[str]) -> str:
    """决定落盘扩展名：content-type 优先，其次原文件名；不合法 → 400。"""
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct:
        if ct not in _EXT_BY_CONTENT_TYPE:
            raise bad_request(f"仅支持 JPG/PNG/GIF/WEBP 图片，收到 content-type={ct}")
        return _EXT_BY_CONTENT_TYPE[ct]
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in _ALLOWED_EXT:
        return ".jpg" if ext == ".jpeg" else ext
    raise bad_request("仅支持 JPG/PNG/GIF/WEBP 图片（无法从文件名判断类型）")


def _receipt_to_response(receipt_result: Dict[str, Any]) -> Dict[str, str]:
    return {"url": receipt_result.get("url", ""),
            "filename": receipt_result.get("filename", "")}


def save_attachment(db: Session, *, content: bytes, filename: str,
                    content_type: Optional[str],
                    client_op_id: Optional[str] = None) -> Dict[str, str]:
    """保存附件并返回 `{url, filename}`（契约 AttachmentUploadResponse）。"""
    if not content:
        raise bad_request("上传内容为空")
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise bad_request(f"图片大小不能超过 {MAX_ATTACHMENT_BYTES // (1024 * 1024)}MB")

    op_id = (client_op_id or "").strip()
    if op_id:
        receipt = get_receipt(db, op_id)
        if receipt is not None:
            cached = dict(receipt.result or {})
            if cached.get("kind") == "photo" and cached.get("url"):
                return _receipt_to_response(cached)

    ext = _resolve_ext(filename, content_type)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    _ensure_dir()
    with open(os.path.join(ATTACHMENT_DIR, stored_name), "wb") as fh:
        fh.write(content)

    url = f"{ATTACHMENT_URL_PREFIX}/{stored_name}"
    if op_id:
        try:
            put_receipt(db, op_id,
                        {"status": "accepted", "kind": "photo",
                         "url": url, "filename": stored_name},
                        server_id=None)
            db.commit()
        except ApiError:
            raise
        except Exception:                      # noqa: BLE001 — 收据写失败不阻断上传结果
            db.rollback()
    return {"url": url, "filename": stored_name}
