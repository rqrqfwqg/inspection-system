"""运维执行域 · 统一错误契约（OpenAPI §0.1 错误码表）。

响应体固定为 `{"code": <int>, "detail": "<message>"}`；仅 409 版本冲突额外带
`"serverVersion"`（供客户端刷新后重试，AC-07）。

为什么单独成模块
----------------
FastAPI 默认把异常包装成 `{"detail": ...}`，而契约要求同时给出应用错误码。
若在每个端点里手写 `JSONResponse`，三端（Web / 小程序 / QA）会读到两套形状。
故此处统一出口：
  · `ApiError`          —— 业务主动抛出，路由/服务层只用它，不直接抛 HTTPException；
  · `api_error_handler` —— 落成契约错误体；
  · `http_exception_handler` —— 兜住依赖层（如 `get_current_user`）抛出的 HTTPException，
    给旧形状补上 `code`，`detail` 原样保留（既有前端读取 `detail`，不得破坏）。
"""
from typing import Any, Dict, Optional

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# ==================== 错误码（OpenAPI §0.1） ====================

CODE_BAD_REQUEST = 40000        # 400 请求参数错误
CODE_UNAUTHORIZED = 40100       # 401 未登录 / 令牌失效
CODE_FORBIDDEN = 40300          # 403 权限不足
CODE_NOT_FOUND = 40400          # 404 资源不存在
CODE_VERSION_CONFLICT = 40900   # 409 版本冲突（附 serverVersion）
CODE_UNPROCESSABLE = 42200      # 422 状态机非法迁移 / 台账校验不通过
CODE_INTERNAL = 50000           # 500 服务端异常
CODE_NOT_IMPLEMENTED = 50100    # 501 一期占位未启用（备件耗用回写 Phase B）
CODE_RATE_LIMITED = 42900       # 429 触发限流（登录等敏感端点）

# HTTP 状态 → 应用错误码（兜底映射，供依赖层 HTTPException 归一）
_STATUS_TO_CODE = {
    400: CODE_BAD_REQUEST,
    401: CODE_UNAUTHORIZED,
    403: CODE_FORBIDDEN,
    404: CODE_NOT_FOUND,
    409: CODE_VERSION_CONFLICT,
    422: CODE_UNPROCESSABLE,
    429: CODE_RATE_LIMITED,
    500: CODE_INTERNAL,
    501: CODE_NOT_IMPLEMENTED,
}

# 需要按本契约（§0.1）返回错误的执行域路径前缀。
# 仅这些前缀下的请求体校验错误改写为 400/40000，其余既有模块维持 FastAPI 默认形状，
# 避免改动资产模块的既有行为（红线：不得改资产核心逻辑）。
_CONTRACT_PATH_PREFIXES = (
    "/ops/api/work-orders",
    "/ops/api/attachments",
    "/ops/api/parts",
    "/ops/api/inventory",
)


class ApiError(Exception):
    """业务异常 → 契约错误体。"""

    def __init__(self, http_status: int, code: int, detail: str,
                 server_version: Optional[int] = None) -> None:
        super().__init__(detail)
        self.http_status = http_status
        self.code = code
        self.detail = detail
        self.server_version = server_version

    def to_body(self) -> Dict[str, Any]:
        body: Dict[str, Any] = {"code": self.code, "detail": self.detail}
        if self.server_version is not None:
            body["serverVersion"] = self.server_version
        return body


# ==================== 语义化构造器 ====================

def bad_request(detail: str) -> ApiError:
    return ApiError(400, CODE_BAD_REQUEST, detail)


def unauthorized(detail: str = "请先登录") -> ApiError:
    return ApiError(401, CODE_UNAUTHORIZED, detail)


def forbidden(detail: str) -> ApiError:
    return ApiError(403, CODE_FORBIDDEN, detail)


def not_found(detail: str) -> ApiError:
    return ApiError(404, CODE_NOT_FOUND, detail)


def unprocessable(detail: str) -> ApiError:
    """422：状态机非法迁移，或 asset_device_code 不在台账（AC-02）。"""
    return ApiError(422, CODE_UNPROCESSABLE, detail)


def version_conflict(detail: str, server_version: int) -> ApiError:
    """409：离线 wo_update 的 version 落后于服务端（AC-07）。必带 serverVersion。"""
    return ApiError(409, CODE_VERSION_CONFLICT, detail, server_version=server_version)


def not_implemented(detail: str) -> ApiError:
    return ApiError(501, CODE_NOT_IMPLEMENTED, detail)


# ==================== 异常处理器 ====================

async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    """业务异常 → {"code", "detail", "serverVersion"?}。"""
    return JSONResponse(status_code=exc.http_status, content=exc.to_body())


async def http_exception_handler(request: Request,
                                 exc: StarletteHTTPException) -> JSONResponse:
    """依赖层/框架层 HTTPException → 补上 code，detail 原样保留。

    例：`get_current_user` 抛 401「请先登录」→ `{"code":40100,"detail":"请先登录"}`。
    """
    detail = exc.detail
    if not isinstance(detail, str):
        detail = str(detail)
    body: Dict[str, Any] = {
        "code": _STATUS_TO_CODE.get(exc.status_code, CODE_INTERNAL),
        "detail": detail,
    }
    headers = getattr(exc, "headers", None)
    return JSONResponse(status_code=exc.status_code, content=body, headers=headers)


async def validation_error_handler(request: Request,
                                   exc: RequestValidationError) -> JSONResponse:
    """请求体校验错误。

    - 执行域路径（本契约 §0.1 约定的 path 前缀）：按 §0.1 归为 400 / 40000（缺必填、类型/格式错）；
    - 其余既有路径：维持 FastAPI 默认 422 + `detail` 列表，不动旧行为。
    """
    path = request.url.path or ""
    if any(path.startswith(p) for p in _CONTRACT_PATH_PREFIXES):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(x) for x in first.get("loc", []) if x not in ("body", "query", "path"))
        msg = first.get("msg", "请求参数错误")
        detail = f"{loc}: {msg}" if loc else msg
        return JSONResponse(status_code=400,
                            content={"code": CODE_BAD_REQUEST, "detail": detail})
    return JSONResponse(status_code=422,
                        content={"detail": jsonable_encoder(exc.errors())})


def register_error_handlers(app) -> None:
    """在 FastAPI 实例上注册统一错误处理（由 main.py 调用）。"""
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
