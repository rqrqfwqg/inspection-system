"""设备台账 redesign · 盘点派生 + 管理员逃生舱 本地验证（隔离测试库，不碰生产）。

本脚本自建一个临时 sqlite（与线上 app.db 完全隔离），seed 已知 fixtures，
验证：GET 带/不带 inventory_status 过滤、PUT override（admin）状态翻转、
DELETE 回退、summary facets、total 守恒、派生口径正确、source_kind。

运行：
  cd inspection-system/backend
  venv/Scripts/python.exe tests/test_asset_ledger_inventory.py
"""
import os
import sys
import tempfile

# 把 backend 目录加入 sys.path（脚本位于 backend/tests/ 下）
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 🔴 免鉴权：让 require_admin 直接拿到 admin（本地验证用）
os.environ["DISABLE_AUTH"] = "true"
os.environ["DEV_MODE"] = "true"

import database  # 必须在改 engine 之前导入，之后再 patch 模块全局

# ---- 把 database 的 engine / Session 指向临时文件（与 app.db 隔离）----
_TMP = tempfile.mkdtemp(prefix="ledger_inv_")
_DB_PATH = os.path.join(_TMP, "test.db")
database.DATABASE_URL = f"sqlite:///{_DB_PATH}"
database.engine = database.create_engine(
    database.DATABASE_URL, connect_args={"check_same_thread": False})
database.SessionLocal = database.sessionmaker(
    autocommit=False, autoflush=False, bind=database.engine)
database.init_db()  # create_all：含新增的 inventory_status_overrides 表

# ---- 导入路由 / 模型（此时引擎已指向临时库）----
from database import (Room, Device, DeviceRelation, Record, FixedAsset,
                      Subsystem, DataTable, RoomInventoryRecord, User)
from asset_routes import _INV_LOCATE_LABEL
import asset_ledger_routes
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()
app.include_router(asset_ledger_routes.router)
client = TestClient(app)


# --------------------------------------------------------------------------
# Seed fixtures
# --------------------------------------------------------------------------
def seed():
    s = database.SessionLocal()
    pw = Subsystem(code="power", name="供电")
    s.add(pw)
    s.flush()
    dt = DataTable(subsystem_id=pw.id, code="power_devices", name="供配电设备")
    s.add(dt)
    s.flush()

    r1 = Room(code="R-101", building="GTC", floor="1F", name="机房A", room_type="设备机房")
    r2 = Room(code="R-102", building="GTC", floor="2F", name="机房B", room_type="设备机房")
    s.add_all([r1, r2])
    s.flush()

    d1 = Device(device_code="D1", name="设备1", subsystem_id=pw.id, room_id=r1.id)
    d2 = Device(device_code="D2", name="设备2", subsystem_id=pw.id, room_id=None)
    d3 = Device(device_code="D3", name="设备3", subsystem_id=pw.id, room_id=None)
    d4 = Device(device_code="D4", name="设备4", subsystem_id=pw.id, room_id=r2.id)
    d5 = Device(device_code="D5", name="设备5", subsystem_id=pw.id, room_id=r1.id)
    s.add_all([d1, d2, d3, d4, d5])
    s.flush()

    s.add(DeviceRelation(from_code="D2", to_code="R-102", relation_type=_INV_LOCATE_LABEL, subsystem_id=pw.id))
    s.add(DeviceRelation(from_code="D4", to_code="R-102", relation_type=_INV_LOCATE_LABEL, subsystem_id=pw.id))
    s.add(DeviceRelation(from_code="D5", to_code="R-102", relation_type=_INV_LOCATE_LABEL, subsystem_id=pw.id))

    s.add(Record(table_id=dt.id, device_code="L1", data={"name": "现场设备1"}))
    s.add(FixedAsset(device_code="F1", asset_name="固定资产1", location="GTC"))

    s.add(RoomInventoryRecord(room_code="R-101", status="completed", device_count=2,
                              operator="op1", completed_at=__import__("datetime").datetime.utcnow()))
    s.add(RoomInventoryRecord(room_code="R-102", status="completed", device_count=3,
                              operator="op2", completed_at=__import__("datetime").datetime.utcnow()))
    s.commit()
    s.close()


def find_item(items, code):
    return next((it for it in items if it["device_code"] == code), None)


# --------------------------------------------------------------------------
# 场景
# --------------------------------------------------------------------------
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f"  -> {detail}" if detail and not cond else ""))


def main():
    seed()
    # 清缓存，确保从空缓存重建
    asset_ledger_routes._invalidate_caches()

    base = "/assets/asset-ledger"

    # 1) 全量
    r = client.get(base).json()
    check("GET 全量 total=7", r["total"] == 7, f"total={r['total']}")
    facets = r["facets"]["inventory_status"]
    check("facets confirmed=4", facets["confirmed"] == 4, str(facets))
    check("facets unconfirmed=3", facets["unconfirmed"] == 3, str(facets))
    check("facets 之和=total(同口径)", facets["confirmed"] + facets["unconfirmed"] == r["total"], str(facets))
    check("所有行 inventory_status 非空", all(it.get("inventory_status") in ("confirmed", "unconfirmed") for it in r["items"]),
          str([it["device_code"] for it in r["items"] if it.get("inventory_status") not in ("confirmed", "unconfirmed")]))

    # 2) confirmed 过滤
    rc = client.get(base, params={"inventory_status": "confirmed"}).json()
    check("GET confirmed total=4", rc["total"] == 4, f"total={rc['total']}")
    check("GET confirmed 全部 confirmed", all(it["inventory_status"] == "confirmed" for it in rc["items"]))

    # 3) unconfirmed 过滤
    ru = client.get(base, params={"inventory_status": "unconfirmed"}).json()
    check("GET unconfirmed total=3", ru["total"] == 3, f"total={ru['total']}")
    check("GET unconfirmed 全部 unconfirmed", all(it["inventory_status"] == "unconfirmed" for it in ru["items"]))

    # 4) 非法枚举 → 4xx（Literal 声明式校验）
    bad = client.get(base, params={"inventory_status": "maybe"})
    check("GET 非法 inventory_status → 422", bad.status_code == 422, f"status={bad.status_code}")

    # 5) 派生口径逐行核对
    d1 = find_item(r["items"], "D1")
    check("D1 derived confirmed (room_id R-101)", d1["inventory_status"] == "confirmed" and d1["inventory_status_source"] == "derived", str(d1))
    check("D1 inventory_room_code=R-101", d1["inventory_room_code"] == "R-101", str(d1.get("inventory_room_code")))
    check("D1 confirmed_by=op1", d1["inventory_confirmed_by"] == "op1", str(d1.get("inventory_confirmed_by")))
    check("D1 confirmed_at 非空", bool(d1["inventory_confirmed_at"]))
    d3 = find_item(r["items"], "D3")
    check("D3 unconfirmed (无绑定)", d3["inventory_status"] == "unconfirmed", str(d3))
    check("D3 inventory_room_code=None", d3["inventory_room_code"] is None)
    d5 = find_item(r["items"], "D5")
    check("D5 confirmed (多房 union，R-101+R-102)", d5["inventory_status"] == "confirmed", str(d5))
    check("D5 inventory_room_code=R-102 (primary=关系绑定)", d5["inventory_room_code"] == "R-102", str(d5.get("inventory_room_code")))
    f1 = find_item(r["items"], "F1")
    check("F1 unconfirmed + source_kind=fixed_assets", f1["inventory_status"] == "unconfirmed" and f1["source_kind"] == "fixed_assets", str(f1))
    l1 = find_item(r["items"], "L1")
    check("L1 unconfirmed + source_kind=ledger_only", l1["inventory_status"] == "unconfirmed" and l1["source_kind"] == "ledger_only", str(l1))

    # 6) DELETE 不存在的覆盖 → 幂等 200 cleared=False
    asset_ledger_routes._invalidate_caches()
    dd = client.delete(f"{base}/D3/inventory-status")
    check("DELETE 无覆盖 D3 → 200 cleared=False", dd.status_code == 200 and dd.json().get("cleared") is False, str(dd.json()))

    # 7) PUT override D3 → confirmed
    asset_ledger_routes._invalidate_caches()
    pu = client.put(f"{base}/D3/inventory-status", json={"status": "confirmed", "reason": "现场已确认但漏盘点"})
    pj = pu.json()
    check("PUT override D3 → 200", pu.status_code == 200, f"status={pu.status_code}")
    check("PUT 返回 source=override", pj.get("source") == "override", str(pj))
    check("PUT 返回 status=confirmed", pj.get("status") == "confirmed", str(pj))

    # 8) 覆盖后 confirmed total=5（守恒：overrides 不计入 total）
    rc2 = client.get(base, params={"inventory_status": "confirmed"}).json()
    check("PUT 后 GET confirmed total=5", rc2["total"] == 5, f"total={rc2['total']}")
    all2 = client.get(base).json()
    check("PUT 后 GET 全量 total 仍=7（守恒）", all2["total"] == 7, f"total={all2['total']}")
    f2 = all2["facets"]["inventory_status"]
    check("PUT 后 facets {5,2}", f2["confirmed"] == 5 and f2["unconfirmed"] == 2, str(f2))

    d3ov = find_item(rc2["items"], "D3")
    check("D3 覆盖行 status=confirmed/source=override", d3ov["inventory_status"] == "confirmed" and d3ov["inventory_status_source"] == "override", str(d3ov))
    check("D3 覆盖行 reason 透出", d3ov["inventory_override_reason"] == "现场已确认但漏盘点", str(d3ov.get("inventory_override_reason")))
    check("D3 覆盖行 confirmed_by=admin", bool(d3ov["inventory_confirmed_by"]), str(d3ov.get("inventory_confirmed_by")))
    check("D3 覆盖行 confirmed_at=overridden_at", bool(d3ov["inventory_confirmed_at"]))

    # 9) DELETE 覆盖 → 回退 derived
    asset_ledger_routes._invalidate_caches()
    dl = client.delete(f"{base}/D3/inventory-status")
    check("DELETE 覆盖 D3 → 200 cleared=True", dl.status_code == 200 and dl.json().get("cleared") is True, str(dl.json()))
    rc3 = client.get(base, params={"inventory_status": "confirmed"}).json()
    check("DELETE 后 GET confirmed 回退 total=4", rc3["total"] == 4, f"total={rc3['total']}")
    check("DELETE 后 D3 不再出现在 confirmed 列表", find_item(rc3["items"], "D3") is None)
    # 从全量取 D3，确认回退为 unconfirmed/derived
    all3 = client.get(base).json()
    d3rev = find_item(all3["items"], "D3")
    check("D3 回退为 unconfirmed/derived", d3rev is not None and d3rev["inventory_status"] == "unconfirmed" and d3rev["inventory_status_source"] == "derived", str(d3rev))

    # 10) PUT 不存在设备 → 404
    asset_ledger_routes._invalidate_caches()
    p404 = client.put(f"{base}/ZZZ-999/inventory-status", json={"status": "confirmed", "reason": "x"})
    check("PUT 不存在设备 → 404", p404.status_code == 404, f"status={p404.status_code}")

    # 11) PUT 非法请求体 → 4xx（Literal + reason min_length）
    p_empty = client.put(f"{base}/D1/inventory-status", json={"status": "confirmed", "reason": "   "})
    check("PUT reason 空 → 422", p_empty.status_code == 422, f"status={p_empty.status_code}")
    p_badstatus = client.put(f"{base}/D1/inventory-status", json={"status": "yes", "reason": "x"})
    check("PUT status 非法 → 422", p_badstatus.status_code == 422, f"status={p_badstatus.status_code}")

    # 12) 非 admin → 403（把 DISABLE_AUTH 关掉且无 token，get_current_user 401；
    #      此处验证 require_admin 守卫存在：用未鉴权模式验证 401 拒绝写操作）
    os.environ["DISABLE_AUTH"] = "false"
    os.environ["DEV_MODE"] = "false"
    from dependencies import set_auth_disabled
    set_auth_disabled(False)
    noauth = client.put(f"{base}/D1/inventory-status", json={"status": "confirmed", "reason": "x"})
    check("未鉴权 PUT → 401（写操作强制登录）", noauth.status_code == 401, f"status={noauth.status_code}")

    failed = [n for (n, ok, _) in results if not ok]
    print("\n==== 结论 ====")
    print(f"通过 {sum(1 for _,ok,_ in results if ok)} / {len(results)}")
    if failed:
        print("失败项：")
        for f in failed:
            print("  -", f)
        sys.exit(1)
    print("全部通过 ✅")


if __name__ == "__main__":
    main()
