"""本地副本端到端验证（Spec §12 全流程）——**绝不触碰生产 app.db**。

做法
----
1. 把 `backend/app.db` 复制到临时目录，**所有**后续操作都只碰副本；
2. 独立子进程跑 `migrate_work_orders.py --db <副本>`（验证迁移脚本本身可跑、幂等建表）；
3. 进程内把 `database.engine` / `database.SessionLocal` 指向副本，再 import `main`；
4. `TestClient` 跑完整成功流、错误流、离线冲突流、RBAC 权限位、备件只读，并做两项守恒断言：
   - 台账 `total` 迁移+写入前后恒为 8977（AC-08）；
   - 生产库文件 hash 前后一致（证明没被写过）。

用法
----
    backend/venv/Scripts/python.exe backend/scripts/validate_work_orders_e2e.py
    （可加 --keep 保留临时副本目录以便复查）
"""
import argparse
import hashlib
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)

EXPECTED_LEDGER_TOTAL = 8977
PWD = "E2ePassw0rd!"
CLIENT_OP_CREATE = "e2e-op-create-0001"
CLIENT_OP_STALE = "e2e-op-update-stale"
CLIENT_OP_UPDATE = "e2e-op-update-ok"
CLIENT_OP_ACTION = "e2e-op-action-0001"
CLIENT_OP_PHOTO = "e2e-op-photo-0001"

NEW_TABLES = (
    "work_orders", "work_order_events", "sync_receipts",
    "spare_parts_catalog", "spare_parts_inventory",
    "work_order_spare_consumptions",
)

RESULTS = []
UPLOADED = []


def check(name, ok, detail=""):
    ok = bool(ok)
    RESULTS.append((name, ok, detail))
    print(("[PASS] " if ok else "[FAIL] ") + name + (f"   <- {detail}" if detail else ""))
    return ok


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _login(client, ident):
    r = client.post("/ops/api/auth/login", json={"phone": ident, "password": PWD})
    assert r.status_code == 200, f"登录失败 {ident}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _events(client, tok, wo_id):
    r = client.get(f"/ops/api/work-orders/{wo_id}/events", headers=_h(tok))
    assert r.status_code == 200, r.text
    return [e["event_type"] for e in r.json()]


def _version(client, tok, wo_id):
    r = client.get(f"/ops/api/work-orders/{wo_id}", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()["version"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(BACKEND_DIR, "app.db"))
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    src = os.path.abspath(args.src)
    src_hash_before = sha256(src)
    src_mtime_before = os.stat(src).st_mtime

    workdir = tempfile.mkdtemp(prefix="wo_e2e_")
    copy_db = os.path.join(workdir, "app.db")
    shutil.copy2(src, copy_db)
    print("=" * 72)
    print(f"[env] 生产库        : {src}")
    print(f"[env] 副本库        : {copy_db}")
    print(f"[env] 生产库 sha256 : {src_hash_before}")
    print("=" * 72)

    # ---------- 1. 迁移脚本（子进程，独立验证） ----------
    proc = subprocess.run(
        [sys.executable, os.path.join(BACKEND_DIR, "migrate_work_orders.py"),
         "--db", copy_db],
        capture_output=True, text=True, cwd=BACKEND_DIR)
    print(proc.stdout.strip())
    check("migrate_work_orders.py 退出码 = 0", proc.returncode == 0,
          f"rc={proc.returncode} {proc.stderr.strip()[:200]}")
    check("迁移执行了完整性体检且结果 ok", "integrity_check = ok" in proc.stdout)
    check("迁移脚本声明资产底座行数守恒", "资产底座行数守恒" in proc.stdout)

    con = sqlite3.connect(copy_db)
    tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()
    missing = [t for t in NEW_TABLES if t not in tables]
    check(f"迁移后 {len(NEW_TABLES)} 张新表齐备（{len(NEW_TABLES) - len(missing)}/{len(NEW_TABLES)}）",
          not missing, str(missing))

    # 幂等复跑：第二次不应报错、不应改变库结构
    proc2 = subprocess.run(
        [sys.executable, os.path.join(BACKEND_DIR, "migrate_work_orders.py"),
         "--db", copy_db],
        capture_output=True, text=True, cwd=BACKEND_DIR)
    check("迁移幂等：第二次执行退出码 = 0", proc2.returncode == 0, f"rc={proc2.returncode}")

    # ---------- 2. 把 ORM 引擎指向副本，再拉起应用 ----------
    import database
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(f"sqlite:///{copy_db}",
                           connect_args={"check_same_thread": False})
    database.engine = engine
    database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    print(f"[env] ORM 绑定      : {engine.url}")

    from dependencies import set_auth_disabled
    set_auth_disabled(False)          # 强制真实鉴权 → 验证 AC-09

    import main
    from fastapi.testclient import TestClient
    from auth import get_password_hash
    from database import User

    # 登录限流（5 次/分/IP）会挡住本脚本的多角色登录；仅在本进程内放宽，不影响线上配置。
    main.login_limiter.max_attempts = 10_000

    with TestClient(main.app) as client:
        # ---------- 3. 造角色用户 ----------
        db = database.SessionLocal()
        ids = {}

        def ensure(ident, role):
            u = db.query(User).filter(User.email == ident).first()
            if u is None:
                u = User(email=ident, name=ident, phone=None,
                         password_hash=get_password_hash(PWD), role=role,
                         is_active=True)
                db.add(u)
            else:
                u.role = role
                u.password_hash = get_password_hash(PWD)
                u.is_active = True
            db.commit()
            db.refresh(u)
            ids[ident] = u.id
            return u.id

        # admin 一并复位为已知口令（线上库里的 admin 口令未知，副本内复位不影响生产）
        for ident, role in (("admin@example.com", "admin"),
                            ("e2e.dispatcher@local", "dispatcher"),
                            ("e2e.reporter@local", "reporter"),
                            ("e2e.executor@local", "executor"),
                            ("e2e.executor2@local", "executor"),
                            ("e2e.reviewer@local", "reviewer")):
            ensure(ident, role)
        check("测试用两个执行人账号 id 不同（AC-04 前提）",
              ids["e2e.executor@local"] != ids["e2e.executor2@local"],
              f"{ids['e2e.executor@local']} vs {ids['e2e.executor2@local']}")
        db.close()

        admin = _login(client, "admin@example.com")
        disp = _login(client, "e2e.dispatcher@local")
        rep = _login(client, "e2e.reporter@local")
        exe = _login(client, "e2e.executor@local")
        exe2 = _login(client, "e2e.executor2@local")
        rev = _login(client, "e2e.reviewer@local")
        check("真实鉴权下 5 个角色登录成功", all([admin, disp, rep, exe, exe2, rev]))

        # 取一个台账真实 device_code 与一个真实 room_code
        led = client.get("/ops/api/assets/asset-ledger",
                         params={"page": 1, "page_size": 1}, headers=_h(admin)).json()
        DEV = led["items"][0]["device_code"]
        rooms = client.get("/ops/api/rooms").json()
        ROOM = rooms[0]["code"]
        BAD_DEV = "E2E-NOT-IN-LEDGER-XYZ"
        # ---------- 3b. /ops 命名空间隔离回归（等价于 backend/test_ops_namespace.py 关键断言） ----------
        for method, path in (("GET", "/api/health"), ("GET", "/api/users/me"),
                             ("GET", "/api/assets/subsystems"),
                             ("POST", "/api/auth/login")):
            r = (client.get(path) if method == "GET" else client.post(path, json={}))
            check(f"命名空间隔离：{method} {path} → 404", r.status_code == 404,
                  str(r.status_code))
        r = client.get("/ops/api/health")
        check("/ops/api/health → 200 status=ok",
              r.status_code == 200 and r.json().get("status") == "ok", str(r.status_code))
        r = client.get("/ops/uploads/avatars/")
        check("/ops/uploads 静态挂载优先于 SPA 兜底（目录 → 404 而非 html）",
              r.status_code == 404, str(r.status_code))
        r = client.get("/", follow_redirects=False)
        check("/ → 301 到 /ops/",
              r.status_code == 301 and r.headers.get("location") == "/ops/",
              f"{r.status_code} {r.headers.get('location')}")

        # ---------- 4. 台账基线（迁移前口径） ----------
        summary = client.get("/ops/api/assets/asset-ledger/summary",
                             headers=_h(admin)).json()
        base_total = summary["total"]
        check(f"AC-08 迁移后台账 total 基线 = {EXPECTED_LEDGER_TOTAL}",
              base_total == EXPECTED_LEDGER_TOTAL, f"got {base_total}")

        # ---------- 5. AC-09 写操作强制登录 ----------
        r = client.post("/ops/api/work-orders",
                        json={"title": "no-token", "type": "corrective"})
        check("AC-09 无 token 建单 → 401", r.status_code == 401,
              f"{r.status_code} {r.text[:120]}")
        check("401 错误体 code = 40100", r.json().get("code") == 40100, str(r.json()))
        r = client.get("/ops/api/work-orders")
        check("AC-09 无 token 读列表 → 401", r.status_code == 401, str(r.status_code))

        # ---------- 6. AC-01 建单 ----------
        r = client.post("/ops/api/work-orders", headers=_h(disp), json={
            "title": "E2E 主流程工单", "type": "corrective", "failure_flag": True,
            "priority": "high", "asset_device_code": DEV, "room_code": ROOM,
            "description": "端到端验证"})
        body = r.json()
        check("AC-01 建单 → 201", r.status_code == 201, f"{r.status_code} {r.text[:160]}")
        check("AC-01 落 pending_dispatch", body.get("status") == "pending_dispatch",
              str(body.get("status")))
        check("编号形如 WO-YYYYMMDD-NNNN",
              bool(re.match(r"^WO-\d{8}-\d{4}$", body.get("code", ""))), str(body.get("code")))
        check("新建单 version = 1", body.get("version") == 1, str(body.get("version")))
        check("reporter_id 缺省为当前登录用户", body.get("reporter_id") == ids["e2e.dispatcher@local"],
              f"{body.get('reporter_id')} vs {ids['e2e.dispatcher@local']}")
        wo_main = body["id"]
        check("created 事件已写入（AC-01）",
              _events(client, admin, wo_main) == ["created"],
              str(_events(client, admin, wo_main)))

        # ---------- 7. AC-02 非法 device_code ----------
        before_cnt = client.get("/ops/api/work-orders", headers=_h(admin)).json()["total"]
        r = client.post("/ops/api/work-orders", headers=_h(disp),
                        json={"title": "非法设备", "type": "corrective",
                              "asset_device_code": BAD_DEV})
        check("AC-02 非法 device_code → 422", r.status_code == 422,
              f"{r.status_code} {r.text[:140]}")
        check("422 错误体 code = 42200", r.json().get("code") == 42200, str(r.json()))
        after_cnt = client.get("/ops/api/work-orders", headers=_h(admin)).json()["total"]
        check("AC-02 非法建单未落库", before_cnt == after_cnt,
              f"{before_cnt} -> {after_cnt}")

        r = client.post("/ops/api/work-orders", headers=_h(disp),
                        json={"title": "非法房间", "type": "corrective",
                              "room_code": "ROOM-NOT-EXIST"})
        check("C2 非法 room_code → 422", r.status_code == 422, str(r.status_code))

        # ---------- 8. 列表过滤 + 分页 ----------
        r = client.get("/ops/api/work-orders", headers=_h(rep), params={
            "status": "pending_dispatch", "type": "corrective",
            "asset_device_code": DEV, "page": 1, "page_size": 1})
        page = r.json()
        check("列表过滤 + 分页字段齐备",
              r.status_code == 200 and set(("items", "total", "page", "page_size", "has_more"))
              <= set(page.keys()), str(list(page.keys())))
        check("分页 page_size 生效", len(page["items"]) <= 1, str(len(page["items"])))

        # ---------- 9. AC-03 权限位不足 ----------
        r = client.post(f"/ops/api/work-orders/{wo_main}/dispatch",
                        headers=_h(rep), json={"assignee_id": ids["e2e.executor@local"]})
        check("AC-03 无 wo.dispatch 派单 → 403", r.status_code == 403,
              f"{r.status_code} {r.text[:140]}")
        check("403 错误体 code = 40300", r.json().get("code") == 40300, str(r.json()))

        # ---------- 10. 派单 + AC-04 限本人 ----------
        r = client.post(f"/ops/api/work-orders/{wo_main}/dispatch", headers=_h(disp),
                        json={"assignee_id": ids["e2e.executor@local"], "note": "请处理"})
        check("dispatch → 200 assigned",
              r.status_code == 200 and r.json().get("status") == "assigned",
              f"{r.status_code} {r.json().get('status')}")
        check("dispatch 后 version 递增到 2", r.json().get("version") == 2,
              str(r.json().get("version")))
        check("dispatched 事件已写入", "dispatched" in _events(client, admin, wo_main))

        r = client.post(f"/ops/api/work-orders/{wo_main}/start", headers=_h(exe2))
        check("AC-04 非 assignee start → 403", r.status_code == 403,
              f"{r.status_code} {r.text[:140]}")

        # ---------- 11. 主链成功流 ----------
        r = client.post(f"/ops/api/work-orders/{wo_main}/start", headers=_h(exe))
        check("start → 200 in_progress",
              r.status_code == 200 and r.json().get("status") == "in_progress",
              f"{r.status_code} {r.json().get('status')}")
        check("started_at 已写", r.json().get("started_at") is not None)

        r = client.post(f"/ops/api/work-orders/{wo_main}/complete", headers=_h(exe),
                        json={"note": "已更换模块", "photo_urls": ["/ops/uploads/attachments/x.jpg"]})
        check("complete → 200 completed",
              r.status_code == 200 and r.json().get("status") == "completed",
              f"{r.status_code} {r.json().get('status')}")
        check("completed_at 已写", r.json().get("completed_at") is not None)

        r = client.post(f"/ops/api/work-orders/{wo_main}/submit-review", headers=_h(exe))
        check("submit-review → 200 pending_review",
              r.status_code == 200 and r.json().get("status") == "pending_review",
              f"{r.status_code} {r.json().get('status')}")

        # AC-05 reject 打回
        r = client.post(f"/ops/api/work-orders/{wo_main}/review", headers=_h(rev),
                        json={"approved": False, "note": "缺照片，打回"})
        check("AC-05 reject → 200 in_progress",
              r.status_code == 200 and r.json().get("status") == "in_progress",
              f"{r.status_code} {r.json().get('status')}")

        # 再次完成 → 提交 → approve 关闭
        client.post(f"/ops/api/work-orders/{wo_main}/complete", headers=_h(exe))
        client.post(f"/ops/api/work-orders/{wo_main}/submit-review", headers=_h(exe))
        r = client.post(f"/ops/api/work-orders/{wo_main}/review", headers=_h(rev),
                        json={"approved": True, "note": "验收通过"})
        check("review(approve) → 200 closed",
              r.status_code == 200 and r.json().get("status") == "closed",
              f"{r.status_code} {r.json().get('status')}")
        check("closed_at 已写", r.json().get("closed_at") is not None)

        evs = _events(client, admin, wo_main)
        check("事件时间线不可变且完整",
              evs == ["created", "dispatched", "started", "completed", "submitted_review",
                      "reviewed_rejected", "completed", "submitted_review",
                      "reviewed_approved", "closed"], str(evs))

        # ---------- 12. 状态机非法迁移 ----------
        r = client.post(f"/ops/api/work-orders/{wo_main}/complete", headers=_h(exe))
        check("对 closed 单 complete → 422", r.status_code == 422,
              f"{r.status_code} {r.text[:140]}")

        # ---------- 13. cancel / reopen ----------
        r = client.post("/ops/api/work-orders", headers=_h(disp),
                        json={"title": "E2E 取消单", "type": "other",
                              "asset_device_code": DEV})
        wo_cancel = r.json()["id"]
        r = client.post(f"/ops/api/work-orders/{wo_cancel}/cancel", headers=_h(disp),
                        json={})
        check("cancel 缺 reason → 400", r.status_code == 400, f"{r.status_code}")
        r = client.post(f"/ops/api/work-orders/{wo_cancel}/cancel", headers=_h(disp),
                        json={"reason": "重复报修"})
        check("cancel → 200 cancelled",
              r.status_code == 200 and r.json().get("status") == "cancelled",
              f"{r.status_code} {r.json().get('status')}")

        r = client.post(f"/ops/api/work-orders/{wo_cancel}/reopen", headers=_h(rev),
                        json={"target_status": "assigned", "note": "复现，重开"})
        ro = r.json()
        check("reopen → 200 且状态 = assigned",
              r.status_code == 200 and ro.get("status") == "assigned",
              f"{r.status_code} {ro.get('status')}")
        check("reopen 新单 parent_id 指向原单", ro.get("parent_id") == wo_cancel,
              f"{ro.get('parent_id')} vs {wo_cancel}")
        check("原单写入 reopened 事件（原单状态不被改写）",
              "reopened" in _events(client, admin, wo_cancel), str(_events(client, admin, wo_cancel)))

        # ---------- 13b. 事件 payload null 收敛（OpenAPI §6.1「缺省键省略，不写 null」） ----------
        r = client.post("/ops/api/work-orders", headers=_h(rep),
                        json={"title": "E2E 无备注关闭单", "type": "other",
                              "asset_device_code": DEV})
        wo_plain = r.json()["id"]
        client.post(f"/ops/api/work-orders/{wo_plain}/dispatch", headers=_h(disp),
                    json={"assignee_id": ids["e2e.executor@local"]})
        client.post(f"/ops/api/work-orders/{wo_plain}/start", headers=_h(exe))
        client.post(f"/ops/api/work-orders/{wo_plain}/complete", headers=_h(exe))
        client.post(f"/ops/api/work-orders/{wo_plain}/submit-review", headers=_h(exe))
        client.post(f"/ops/api/work-orders/{wo_plain}/review", headers=_h(rev),
                    json={"approved": True})
        evs_plain = client.get(f"/ops/api/work-orders/{wo_plain}/events",
                               headers=_h(admin)).json()
        created_p = next(e for e in evs_plain if e["event_type"] == "created")["payload"]
        check("null 收敛：created 缺省 room_code/parent_id 键省略、asset_device_code 保留",
              "room_code" not in created_p and "parent_id" not in created_p
              and "asset_device_code" in created_p, str(created_p))
        closed_p = next(e for e in evs_plain if e["event_type"] == "closed")["payload"]
        check("null 收敛：无备注 close 不写 note 键（此前写 note:null）",
              "note" not in closed_p, str(closed_p))
        check("null 收敛：该单全部事件 payload 均不含 null 值键",
              all(v is not None for e in evs_plain
                  for v in (e["payload"] or {}).values()),
              str([{k: v for k, v in (e["payload"] or {}).items() if v is None}
                   for e in evs_plain]))

        # ---------- 14. 离线同步：幂等 / 冲突 / 动作 ----------
        op_create = {"id": CLIENT_OP_CREATE, "kind": "wo_create",
                     "payload": {"title": "E2E 离线建单", "type": "corrective",
                                 "asset_device_code": DEV},
                     "createdAt": 1700000000000}
        r1 = client.post("/ops/api/work-orders/sync", headers=_h(disp),
                         json={"ops": [op_create]}).json()["results"][0]
        r2 = client.post("/ops/api/work-orders/sync", headers=_h(disp),
                         json={"ops": [op_create]}).json()["results"][0]
        check("sync wo_create → accepted", r1["status"] == "accepted", str(r1))
        check("sync 幂等：重放同 client_op_id 返回同 serverId",
              r1["serverId"] == r2["serverId"] and r2["status"] == "accepted",
              f"{r1['serverId']} vs {r2['serverId']}")
        cnt = client.get("/ops/api/work-orders", headers=_h(admin),
                         params={"page_size": 200}).json()
        titles = [i["title"] for i in cnt["items"]]
        check("sync 幂等：离线建单只落 1 张", titles.count("E2E 离线建单") == 1,
              f"count={titles.count('E2E 离线建单')}")
        wo_sync = r1["serverId"]
        check("sync 建单写入 created 事件且带 client_op_id",
              "created" in _events(client, admin, wo_sync))

        cur_v = _version(client, admin, wo_sync)
        r = client.post("/ops/api/work-orders/sync", headers=_h(disp), json={"ops": [
            {"id": CLIENT_OP_STALE, "kind": "wo_update", "entityId": str(wo_sync),
             "version": cur_v - 1, "payload": {"title": "不该生效的标题"}}]}).json()["results"][0]
        check("AC-07 旧 version → conflict", r["status"] == "conflict", str(r))
        check("AC-07 conflict 带 serverVersion",
              r.get("serverVersion") == cur_v, f"{r.get('serverVersion')} vs {cur_v}")
        now_title = client.get(f"/ops/api/work-orders/{wo_sync}",
                               headers=_h(admin)).json()["title"]
        check("AC-07 冲突不自动覆盖（标题未变）", now_title == "E2E 离线建单", now_title)

        r = client.post("/ops/api/work-orders/sync", headers=_h(disp), json={"ops": [
            {"id": CLIENT_OP_UPDATE, "kind": "wo_update", "entityId": str(wo_sync),
             "version": cur_v, "payload": {"title": "离线改名成功"}}]}).json()["results"][0]
        check("version 一致 → accepted 且 version+1",
              r["status"] == "accepted" and r["serverVersion"] == cur_v + 1, str(r))

        r = client.post("/ops/api/work-orders/sync", headers=_h(disp), json={"ops": [
            {"id": CLIENT_OP_ACTION, "kind": "wo_action", "entityId": str(wo_sync),
             "action": "dispatch", "payload": {"assignee_id": ids["e2e.executor@local"]}}]}).json()["results"][0]
        check("sync wo_action(dispatch) → accepted", r["status"] == "accepted", str(r))
        check("sync 动作已生效（状态 assigned）",
              client.get(f"/ops/api/work-orders/{wo_sync}",
                         headers=_h(admin)).json()["status"] == "assigned")

        # 单条失败不影响其余条目
        res = client.post("/ops/api/work-orders/sync", headers=_h(disp), json={"ops": [
            {"id": "e2e-op-bad-1", "kind": "wo_update", "entityId": "999999",
             "version": 1, "payload": {"title": "不存在"}},
            {"id": "e2e-op-bad-2", "kind": "wo_action", "entityId": str(wo_sync),
             "action": "complete", "payload": {}}]}).json()["results"]
        check("sync 逐条隔离：一条 error 不影响另一条判定",
              res[0]["status"] == "error" and res[1]["status"] == "error", str(res))

        # ---------- 15. 附件上传（幂等） ----------
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x06\x00\x00\x00")
        r1 = client.post("/ops/api/attachments/upload", headers=_h(exe),
                         files={"file": ("e2e.png", png, "image/png")},
                         data={"client_op_id": CLIENT_OP_PHOTO})
        b1 = r1.json()
        check("附件上传 → 201 + /ops/uploads/attachments URL",
              r1.status_code == 201 and b1.get("url", "").startswith(
                  "/ops/uploads/attachments/"), f"{r1.status_code} {r1.text[:140]}")
        UPLOADED.append(b1.get("filename"))
        r2 = client.post("/ops/api/attachments/upload", headers=_h(exe),
                         files={"file": ("e2e.png", png, "image/png")},
                         data={"client_op_id": CLIENT_OP_PHOTO})
        check("附件幂等：同 client_op_id 返回同 URL",
              r2.json().get("url") == b1.get("url"),
              f"{b1.get('url')} vs {r2.json().get('url')}")
        r = client.post("/ops/api/attachments/upload", headers=_h(exe),
                        files={"file": ("bad.txt", b"hi", "text/plain")})
        check("附件类型白名单 → 400", r.status_code == 400, str(r.status_code))

        # ---------- 17. 备件联邦只读（对外仅 /ops/api；/api 前缀不挂载） ----------
        # 硬约束：本系统对外只走 /ops/api/*；同域 /api/* 由 nginx 反代到 tools-management，
        # 后端不得再挂 /api 前缀，故 /api/parts|inventory|consume 一律 404（命名空间隔离）。
        r = client.get("/api/parts", headers=_h(admin))
        check("命名空间隔离 GET /api/parts → 404（/api 前缀已移除）",
              r.status_code == 404, str(r.status_code))
        r = client.get("/api/inventory", headers=_h(admin))
        check("命名空间隔离 GET /api/inventory → 404", r.status_code == 404, str(r.status_code))
        r = client.post("/api/inventory/consume", headers=_h(admin),
                        json={"part_code": "P1", "qty": 1, "operator": 1})
        check("命名空间隔离 POST /api/inventory/consume → 404",
              r.status_code == 404, str(r.status_code))
        r_parts = client.get("/ops/api/parts", headers=_h(admin))
        r_inv = client.get("/ops/api/inventory", headers=_h(admin))
        check("GET /ops/api/parts|inventory → 200 数组（唯一对外路径）",
              r_parts.status_code == 200 and isinstance(r_parts.json(), list)
              and r_inv.status_code == 200 and isinstance(r_inv.json(), list),
              f"{r_parts.status_code} {r_inv.status_code}")
        r = client.post("/ops/api/inventory/consume", headers=_h(admin),
                        json={"part_code": "P1", "qty": 1, "operator": 1})
        check("POST /ops/api/inventory/consume → 501 占位且 code=50100",
              r.status_code == 501 and r.json().get("code") == 50100,
              f"{r.status_code} {r.text[:120]}")

        # ---------- 17b. /me 返回权限位（供前端精确禁用按钮） ----------
        r = client.get("/ops/api/users/me", headers=_h(rep))
        check("/me permissions（reporter = [wo.create]）",
              r.status_code == 200 and r.json().get("permissions") == ["wo.create"],
              str(r.json().get("permissions")))
        r = client.post("/ops/api/auth/login",
                        json={"phone": "e2e.executor@local", "password": PWD})
        check("login 响应 user.permissions 亦填充（executor = create/execute）",
              r.status_code == 200
              and set(r.json().get("user", {}).get("permissions", []))
              == {"wo.create", "wo.execute"},
              str(r.json().get("user", {}).get("permissions")))
        r = client.get("/ops/api/users/me", headers=_h(disp))
        check("/me permissions（dispatcher = create/dispatch/cancel）",
              r.status_code == 200
              and set(r.json().get("permissions", []))
              == {"wo.create", "wo.dispatch", "wo.cancel"},
              str(r.json().get("permissions")))
        r = client.get("/ops/api/users/me", headers=_h(rev))
        check("/me permissions（reviewer = review/cancel，不含 create）",
              r.status_code == 200
              and set(r.json().get("permissions", [])) == {"wo.review", "wo.cancel"},
              str(r.json().get("permissions")))

        # ---------- 17c. 列表查询扩展参数（q/priority/due_from/due_to/sort/order） ----------
        def _lst(**params):
            return client.get("/ops/api/work-orders", headers=_h(admin),
                              params=params).json()

        def _nulls_last(rows):
            """断言「一旦出现 due_at=None，其后不再出现非空」且末行确为空 —— 即空值恒最后。"""
            seen_null = False
            for it in rows:
                if it["due_at"] is None:
                    seen_null = True
                elif seen_null:
                    return False
            return bool(rows) and rows[-1]["due_at"] is None

        # 造三个可控夹具：阿尔法(high/10-01)、贝塔(urgent/10-03)、伽马(low/无 due_at)
        pa = client.post("/ops/api/work-orders", headers=_h(disp), json={
            "title": "E2E列表扩展 阿尔法", "type": "corrective", "priority": "high",
            "asset_device_code": DEV, "due_at": "2026-10-01T10:00:00"}).json()
        pb = client.post("/ops/api/work-orders", headers=_h(disp), json={
            "title": "E2E列表扩展 贝塔", "type": "preventive", "priority": "urgent",
            "due_at": "2026-10-03T10:00:00"}).json()
        pc = client.post("/ops/api/work-orders", headers=_h(disp), json={
            "title": "E2E列表扩展 伽马", "type": "other", "priority": "low"}).json()
        wo_qa, code_qa, wo_qb, wo_qc = pa["id"], pa["code"], pb["id"], pc["id"]

        d = _lst(q="阿尔法")
        check("q 命中 title 片段 → 有结果",
              d["total"] >= 1 and any(i["id"] == wo_qa for i in d["items"]), str(d["total"]))
        d = _lst(q=code_qa)
        check("q 命中 code 片段 → 有结果",
              any(i["id"] == wo_qa for i in d["items"]), str(d["total"]))
        d = _lst(q="E2E-绝对不存在的串-ZZZ")
        check("q 无命中 → 0 条", d["total"] == 0, str(d["total"]))
        all_total = _lst()["total"]
        d = _lst(q="%")
        check("q=% 被转义为字面量（不得返回全表）",
              d["total"] == 0 and d["total"] != all_total, f'{d["total"]} vs {all_total}')

        d = _lst(priority="high")
        check("priority=high 仅返回 high",
              d["total"] >= 1 and all(i["priority"] == "high" for i in d["items"]),
              str([i["priority"] for i in d["items"]][:6]))

        d = _lst(due_from="2026-10-01", due_to="2026-10-01")
        ids_range = {i["id"] for i in d["items"]}
        check("due 闭区间含边界当日（命中 2026-10-01）", wo_qa in ids_range, str(sorted(ids_range)))
        check("due 区间排除区间外 / 无 due_at 行",
              wo_qb not in ids_range and wo_qc not in ids_range, str(sorted(ids_range)))

        d_asc = _lst(sort="due_at", order="asc", page_size=200)
        check("sort=due_at asc：无 due_at 行恒排最后（且最早 due 在前）",
              _nulls_last(d_asc["items"]) and d_asc["items"][0]["id"] == wo_qa,
              str([(i["id"], i["due_at"]) for i in d_asc["items"]]))
        d_desc = _lst(sort="due_at", order="desc", page_size=200)
        check("sort=due_at desc：无 due_at 行仍排最后（且最晚 due 在前）",
              _nulls_last(d_desc["items"]) and d_desc["items"][0]["id"] == wo_qb,
              str([(i["id"], i["due_at"]) for i in d_desc["items"]]))

        d = _lst(sort="priority", order="desc", page_size=200)
        seq = [i["id"] for i in d["items"]]
        check("sort=priority desc：urgent 排在 low 之前（非字典序）",
              seq.index(wo_qb) < seq.index(wo_qc),
              f"{seq.index(wo_qb)} vs {seq.index(wo_qc)}")

        p1 = _lst(page=1, page_size=1)
        p2 = _lst(page=2, page_size=1)
        check("page_size=1 连翻两页 id 不重复",
              p1["items"][0]["id"] != p2["items"][0]["id"],
              f'{p1["items"][0]["id"]} vs {p2["items"][0]["id"]}')

        d_default = _lst(page_size=200)
        d_explicit = _lst(sort="created_at", order="desc", page_size=200)
        check("默认排序 == 显式 created_at desc（回归：逐字节一致）",
              [i["id"] for i in d_default["items"]] == [i["id"] for i in d_explicit["items"]],
              str(d_default["total"]))

        # ---------- 17d. page / page_size 边界校验（契约 minimum/maximum） ----------
        d = _lst()
        check("默认 page=1 / page_size=20（回归）",
              d["page"] == 1 and d["page_size"] == 20, f'{d["page"]}/{d["page_size"]}')
        r = client.get("/ops/api/work-orders", headers=_h(admin), params={"page_size": 200})
        check("page_size=200（边界内）→ 200",
              r.status_code == 200 and r.json()["page_size"] == 200, str(r.status_code))
        for bad in ({"page_size": 201}, {"page_size": 0}, {"page": 0}, {"page": -1}):
            r = client.get("/ops/api/work-orders", headers=_h(admin), params=bad)
            check(f"{bad} → 400/40000（不静默）",
                  r.status_code == 400 and r.json().get("code") == 40000,
                  f"{r.status_code} {r.text[:110]}")

        # q 超长（>100）：按前 100 字符截断、不报错
        q100 = "Q" * 100
        wo_long = client.post("/ops/api/work-orders", headers=_h(disp), json={
            "title": q100 + "尾标记XYZ", "type": "other",
            "priority": "medium", "asset_device_code": DEV}).json()["id"]
        d = _lst(q=q100 + "更多不该被用到")
        check("q 超长按前 100 字符截断且不报错",
              d["total"] >= 1 and any(i["id"] == wo_long for i in d["items"]), str(d["total"]))

        for bad_param in ("sort", "order", "priority"):
            r = client.get("/ops/api/work-orders", headers=_h(admin),
                           params={bad_param: "xxx"})
            check(f"非法 {bad_param} → 400/40000（不静默忽略/回退）",
                  r.status_code == 400 and r.json().get("code") == 40000,
                  f"{r.status_code} {r.text[:120]}")

        # ---------- 17e. status / type 枚举校验（第 4 处「静默算错」同源收口） ----------
        # 此前两者是裸 str：非法值返回 200 + total=0，用户看到「共 0 条」而非「参数非法」。
        # 契约（OpenAPI $ref WorkOrderStatus / WorkOrderType）本就声明为枚举，故补齐实现。
        for _k, _v in (("status", "NOT_A_STATUS"), ("type", "bogus")):
            r = client.get("/ops/api/work-orders", headers=_h(admin), params={_k: _v})
            check(f"非法 {_k}「{_v}」→ 400/40000（不得 200 + total=0）",
                  r.status_code == 400 and r.json().get("code") == 40000,
                  f"{r.status_code} {r.text[:110]}")

        # 7 个合法 status 逐个：必须被接受（200）且返回行全部匹配（Literal 漏值会锁死功能）
        for _st in ("pending_dispatch", "assigned", "in_progress", "completed",
                    "pending_review", "closed", "cancelled"):
            d = _lst(status=_st, page_size=200)
            check(f"合法 status「{_st}」被接受且过滤正确（{d['total']} 条）",
                  all(i["status"] == _st for i in d["items"]),
                  f'total={d["total"]} mismatch={[i["status"] for i in d["items"] if i["status"] != _st][:3]}')
        _pd = _lst(status="pending_dispatch", page_size=200)
        check("合法 status「pending_dispatch」确有数据（夹具 pa/pb/pc/wo_long）",
              _pd["total"] >= 4, str(_pd["total"]))

        # 3 个合法 type 逐个
        for _tp in ("preventive", "corrective", "other"):
            d = _lst(type=_tp, page_size=200)
            check(f"合法 type「{_tp}」被接受且过滤正确（{d['total']} 条）",
                  all(i["type"] == _tp for i in d["items"]),
                  f'total={d["total"]} mismatch={[i["type"] for i in d["items"] if i["type"] != _tp][:3]}')

        # 不传 status/type：不得施加任何默认过滤（返回多种状态）
        d_none = _lst(page_size=200)
        _seen = {i["status"] for i in d_none["items"]}
        check("不传 status/type：不施加默认过滤（多种状态并存）",
              len(_seen) >= 2 and d_none["total"] >= 4,
              f'total={d_none["total"]} statuses={sorted(_seen)}')

        # ---------- 17f. 7 个动作端点真乐观锁（用户决策 B：动作也返回 409） ----------
        # 契约：动作 schema 增加可选 version；带且过期 -> 409 + 40900 + serverVersion，
        # 且整体回滚（状态 / version / 事件均不得变化）。不带 version 时行为与此前逐字节一致。
        def _mk(title):
            return client.post("/ops/api/work-orders", headers=_h(disp),
                               json={"title": title, "type": "other",
                                     "priority": "medium",
                                     "asset_device_code": DEV}).json()

        def _snap(wo_id):
            b = client.get(f"/ops/api/work-orders/{wo_id}", headers=_h(admin)).json()
            evc = len(client.get(f"/ops/api/work-orders/{wo_id}/events",
                                 headers=_h(admin)).json())
            return b["version"], b["status"], evc

        EXE = ids["e2e.executor@local"]

        # (1) 带正确 version：7 个动作各成功一次
        wA = _mk("E2E乐观锁 主链")
        wAid = wA["id"]
        r = client.post(f"/ops/api/work-orders/{wAid}/dispatch", headers=_h(disp),
                        json={"assignee_id": EXE, "version": _version(client, admin, wAid)})
        check("乐观锁(正确version)：dispatch -> 200 assigned",
              r.status_code == 200 and r.json()["status"] == "assigned",
              str(r.status_code))
        r = client.post(f"/ops/api/work-orders/{wAid}/start", headers=_h(exe),
                        json={"version": _version(client, admin, wAid)})
        check("乐观锁(正确version)：start -> 200 in_progress",
              r.status_code == 200 and r.json()["status"] == "in_progress", str(r.status_code))
        r = client.post(f"/ops/api/work-orders/{wAid}/complete", headers=_h(exe),
                        json={"version": _version(client, admin, wAid)})
        check("乐观锁(正确version)：complete -> 200 completed",
              r.status_code == 200 and r.json()["status"] == "completed", str(r.status_code))
        r = client.post(f"/ops/api/work-orders/{wAid}/submit-review", headers=_h(exe),
                        json={"version": _version(client, admin, wAid)})
        check("乐观锁(正确version)：submit-review -> 200 pending_review",
              r.status_code == 200 and r.json()["status"] == "pending_review", str(r.status_code))
        r = client.post(f"/ops/api/work-orders/{wAid}/review", headers=_h(rev),
                        json={"approved": True, "version": _version(client, admin, wAid)})
        check("乐观锁(正确version)：review -> 200 closed",
              r.status_code == 200 and r.json()["status"] == "closed", str(r.status_code))
        wB = _mk("E2E乐观锁 取消单")
        wBid = wB["id"]
        r = client.post(f"/ops/api/work-orders/{wBid}/cancel", headers=_h(disp),
                        json={"reason": "重复报修", "version": _version(client, admin, wBid)})
        check("乐观锁(正确version)：cancel -> 200 cancelled",
              r.status_code == 200 and r.json()["status"] == "cancelled", str(r.status_code))
        r = client.post(f"/ops/api/work-orders/{wBid}/reopen", headers=_h(rev),
                        json={"target_status": "assigned", "note": "重开",
                              "version": _version(client, admin, wBid)})
        check("乐观锁(正确version)：reopen -> 200（守原单版本，parent_id 指向原单）",
              r.status_code == 200 and r.json()["status"] == "assigned"
              and r.json()["parent_id"] == wBid, str(r.status_code))

        # (2) 过期 version -> 409 + 40900 + serverVersion == 当前 version，且零副作用
        wC = _mk("E2E乐观锁 冲突单")
        wCid = wC["id"]
        client.post(f"/ops/api/work-orders/{wCid}/dispatch", headers=_h(disp),
                    json={"assignee_id": EXE})
        ver0, st0, ev0 = _snap(wCid)
        r = client.post(f"/ops/api/work-orders/{wCid}/start", headers=_h(exe),
                        json={"version": 1})
        check("过期 version -> 409", r.status_code == 409, str(r.status_code))
        check("409 错误体 code = 40900", r.json().get("code") == 40900, str(r.json()))
        check("409 带 serverVersion == 服务端当前 version",
              r.json().get("serverVersion") == ver0,
              str(r.json().get("serverVersion")) + " vs " + str(ver0))
        ver1, st1, ev1 = _snap(wCid)
        check("冲突零副作用：状态未变、version 未推进",
              ver1 == ver0 and st1 == st0, "ver " + str(ver0) + "->" + str(ver1) + " st " + st0 + "->" + st1)
        check("冲突零副作用：事件表未新增半条", ev1 == ev0, str(ev0) + "->" + str(ev1))

        # 过期 version 且状态也非法 -> 仍 409（证版本检查早于状态机）
        r = client.post(f"/ops/api/work-orders/{wCid}/dispatch", headers=_h(disp),
                        json={"assignee_id": EXE, "version": 1})
        check("过期 version 且状态非法 -> 仍 409（版本先于状态机）",
              r.status_code == 409 and r.json().get("code") == 40900, str(r.status_code))

        # (5) 冲突可恢复：用正确 version 重试同一动作 -> 成功
        r = client.post(f"/ops/api/work-orders/{wCid}/start", headers=_h(exe),
                        json={"version": ver0})
        check("冲突可恢复：正确 version 重试 start -> 200 in_progress",
              r.status_code == 200 and r.json()["status"] == "in_progress", str(r.status_code))

        # (3) 不带 version -> 成功（向后兼容，行为与改动前逐字节一致）
        wD = _mk("E2E乐观锁 无version")
        wDid = wD["id"]
        r = client.post(f"/ops/api/work-orders/{wDid}/dispatch", headers=_h(disp),
                        json={"assignee_id": EXE})
        check("不带 version -> 200（向后兼容）",
              r.status_code == 200 and r.json()["status"] == "assigned", str(r.status_code))

        # (4) /sync 的 wo_action 带旧 version -> 仍 accepted（离线链路不得被误伤）
        wE = _mk("E2E乐观锁 离线动作")
        wEid = wE["id"]
        op_act = {"id": "e2e-op-action-stale-1", "kind": "wo_action",
                  "entityId": str(wEid), "version": 999,
                  "action": "dispatch", "payload": {"assignee_id": EXE},
                  "createdAt": 1700000000000}
        sr = client.post("/ops/api/work-orders/sync", headers=_h(disp),
                         json={"ops": [op_act]}).json()["results"][0]
        check("/sync wo_action 带旧 version -> 仍 accepted（不被 409 拦截）",
              sr["status"] == "accepted", str(sr))
        st_e = client.get(f"/ops/api/work-orders/{wEid}", headers=_h(admin)).json()["status"]
        check("/sync wo_action 确实生效（assigned）", st_e == "assigned", str(st_e))

        # ---------- 18. 守恒断言（写入之后） ----------
        summary_after = client.get("/ops/api/assets/asset-ledger/summary",
                                   headers=_h(admin)).json()
        check(f"AC-08 建表 + 建单后台账 total 仍为 {EXPECTED_LEDGER_TOTAL}",
              summary_after["total"] == EXPECTED_LEDGER_TOTAL,
              f"got {summary_after['total']}")
        r = client.get("/ops/api/assets/asset-ledger", headers=_h(admin),
                       params={"page": 1, "page_size": 1}).json()
        check("台账列表 total 同步守恒", r["total"] == EXPECTED_LEDGER_TOTAL,
              f"got {r['total']}")

    # ---------- 19. 新表有数据、生产库未被触碰 ----------
    con = sqlite3.connect(copy_db)
    counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in NEW_TABLES}
    con.close()
    print("[db] 新表行数：", counts)
    check("work_orders 已落数据", counts["work_orders"] > 0, str(counts["work_orders"]))
    check("work_order_events 已落数据", counts["work_order_events"] > 0,
          str(counts["work_order_events"]))
    check("sync_receipts 已落幂等收据", counts["sync_receipts"] > 0,
          str(counts["sync_receipts"]))

    src_hash_after = sha256(src)
    src_mtime_after = os.stat(src).st_mtime
    check("生产 app.db sha256 未被改动", src_hash_after == src_hash_before,
          f"{src_hash_before[:12]} -> {src_hash_after[:12]}")
    check("生产 app.db mtime 未被改动", src_mtime_after == src_mtime_before)

    # ---------- 清理 ----------
    for name in UPLOADED:
        if not name:
            continue
        p = os.path.join(BACKEND_DIR, "uploads", "attachments", name)
        if os.path.exists(p):
            os.remove(p)
    if args.keep:
        print(f"[env] 保留临时目录：{workdir}")
    else:
        shutil.rmtree(workdir, ignore_errors=True)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    print("=" * 72)
    print(f"结果：{passed}/{total} 通过")
    if passed != total:
        print("失败项：")
        for name, ok, detail in RESULTS:
            if not ok:
                print(f"  - {name}   <- {detail}")
    print("=" * 72)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
