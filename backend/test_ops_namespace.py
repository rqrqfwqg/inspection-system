"""OPS 命名空间隔离 + 取消登录 回归测试（HTTP 级，基于 FastAPI TestClient）

覆盖改造核心点：
1. 路由前缀：/ops/api/* 可用；旧 /api/* 必须 404
2. 健康检查 /ops/api/health 返回 {status:"ok"}
3. SPA 与静态资源：/ops/、/ops/* 返回 html；/ 301 到 /ops/；/ops/vite.svg 为 svg
4. 取消登录（免鉴权）：users/me 无 token 返回 admin；auth/login 兼容 200；受保护接口免 Authorization
5. 上传命名空间：返回路径前缀 /ops/uploads/
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

# 让同目录的 main 可导入
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main  # noqa: E402


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(PROJECT_ROOT, "dist")


@pytest.fixture(scope="module")
def client():
    # TestClient 会自动触发 lifespan（init_db / 种子 / 命名空间迁移），均为幂等
    with TestClient(main.app) as c:
        yield c


# ===================== 1. 路由前缀 =====================

def test_ops_api_health_200(client):
    r = client.get("/ops/api/health")
    assert r.status_code == 200


def test_ops_api_assets_subsystems_200(client):
    r = client.get("/ops/api/assets/subsystems")
    assert r.status_code == 200


def test_ops_api_cad_upload_reachable(client):
    # 上传非 DXF 文件应到达 handler 并返回 400（仅支持 DXF），证明 /ops/api/cad/upload 已挂载
    r = client.post("/ops/api/cad/upload", files={"file": ("notcad.txt", b"hi", "text/plain")})
    assert r.status_code == 400
    assert "DXF" in r.json().get("detail", "")


def test_ops_api_users_me_200(client):
    r = client.get("/ops/api/users/me")
    assert r.status_code == 200


def test_ops_api_auth_login_compat_200(client):
    r = client.post("/ops/api/auth/login", json={"phone": "x", "password": "y"})
    assert r.status_code == 200


def test_old_api_prefix_returns_404(client):
    # 旧顶层 /api/* 必须与物料系统物理隔离，运维系统不再响应
    cases = [
        ("GET", "/api/health"),
        ("GET", "/api/users/me"),
        ("GET", "/api/assets/subsystems"),
        ("POST", "/api/auth/login"),
    ]
    for method, path in cases:
        if method == "GET":
            r = client.get(path)
        else:
            r = client.post(path, json={})
        assert r.status_code == 404, f"{method} {path} 应返回 404，实际 {r.status_code}"


# ===================== 2. 健康检查结构 =====================

def test_health_payload_shape(client):
    r = client.get("/ops/api/health")
    data = r.json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "timestamp" in data


# ===================== 3. SPA 与静态资源 =====================

def test_ops_root_serves_index_html(client):
    r = client.get("/ops/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_ops_no_trailing_slash_serves_index_html(client):
    r = client.get("/ops")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_root_redirects_to_ops(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 301
    assert r.headers["location"] == "/ops/"


def test_ops_vite_svg_mime(client):
    r = client.get("/ops/vite.svg")
    assert r.status_code == 200
    assert "image/svg+xml" in r.headers["content-type"]


def test_ops_spa_fallback(client):
    r = client.get("/ops/some/deep/spa/route")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_ops_api_not_swallowed_by_spa_fallback(client):
    # API 路由优先级必须高于 SPA catch-all，否则会返回 index.html
    r = client.get("/ops/api/health")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_ops_assets_mounted_and_served(client):
    assets_dir = os.path.join(DIST_DIR, "assets")
    files = sorted(os.listdir(assets_dir))
    js = next((f for f in files if f.endswith(".js")), None)
    assert js is not None, "dist/assets 下未找到 js 产物"
    r = client.get(f"/ops/assets/{js}")
    assert r.status_code == 200
    assert len(r.content) > 0


def test_ops_uploads_mount_precedence_over_spa(client):
    # /ops/uploads/ 必须在 SPA catch-all 之前被 StaticFiles 命中（目录无索引 → 404，而非 200 index.html）
    r = client.get("/ops/uploads/avatars/")
    assert r.status_code == 404


# ===================== 4. 取消登录（免鉴权） =====================

def test_users_me_no_token_returns_admin(client):
    # 不携带任何 Authorization 头
    r = client.get("/ops/api/users/me", headers={})
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "admin"


def test_auth_login_compat_returns_placeholder_token(client):
    r = client.post("/ops/api/auth/login", json={"phone": "admin@example.com", "password": "whatever"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["user"]["role"] == "admin"


def test_protected_endpoint_works_without_auth_header(client):
    # 受保护接口（依赖 get_current_user）在免鉴权模式下不应要求 Authorization
    r = client.get("/ops/api/duty-schedules", headers={})
    assert r.status_code == 200


# ===================== 5. 上传命名空间 =====================

def test_upload_avatar_returns_ops_uploads_path(client):
    # 构造最小 PNG（仅校验 content_type 与大小，不要求合法图像）
    png_magic = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    r = client.post(
        "/ops/api/upload/avatar",
        files={"file": ("qa_test.png", png_magic, "image/png")},
    )
    assert r.status_code == 200
    body = r.json()
    assert body.get("success") is True
    assert body["avatar_url"].startswith("/ops/uploads/avatars/")
    # 清理测试产生的上传文件
    fname = body["avatar_url"].rstrip("/").split("/")[-1]
    uploaded = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "avatars", fname)
    if os.path.exists(uploaded):
        os.remove(uploaded)
