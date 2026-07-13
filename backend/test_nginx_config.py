"""Nginx 配置静态检查：确认 inspection-system 只保留 /ops 命名空间相关 location，
且已删除与同机物料管理系统冲突的 / 、/api/ 、/assets/ 、/vite.svg 、/uploads/ 顶层块。

仅解析“未注释”的 location 指令，避免被注释掉的冲突块（# location /api/ ...）误判。
"""
import os
import re

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NGINX_CONF = os.path.join(PROJECT_ROOT, "deploy", "nginx-inspection.conf")


def _active_locations(text):
    """返回所有未被注释的 location 声明（如 'location /ops/'、'location = /ops'）。"""
    locs = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = re.search(r"location\s+[^ {]+", stripped)
        if m:
            locs.append(m.group(0))
    return locs


def test_nginx_conf_exists():
    assert os.path.exists(NGINX_CONF), "deploy/nginx-inspection.conf 不存在"


def test_nginx_only_ops_locations():
    with open(NGINX_CONF, encoding="utf-8") as f:
        text = f.read()
    active = _active_locations(text)

    # 必须保留 /ops 与 /ops/uploads 命名空间
    assert any(l in ("location /ops/", "location = /ops") for l in active), \
        f"缺少 /ops location 声明: {active}"
    assert "location /ops/uploads/" in active, \
        f"缺少 /ops/uploads location 声明: {active}"

    # 不应存在与物料系统冲突的顶层 location（精确匹配，避免误伤 /ops）
    forbidden_exact = {
        "location /api/",        # 物料系统 /api/
        "location /assets/",     # 物料系统 /assets/
        "location /vite.svg",    # 顶层 vite.svg
        "location /uploads/",    # 顶层 /uploads/（仅允许 /ops/uploads/）
        "location /",            # 根路径（物料系统首页）
    }
    for l in active:
        assert l not in forbidden_exact, f"发现与物料系统冲突的 location 块: {l}"
