"""同房间设备合并（减少台账同类项）· 隔离测试库验证，不碰生产。

覆盖：
  1. 同房间两台 → 合并成功，别名写入、记录改挂、位置边清理
  2. 跨房间合并 → 409 拒绝（红线②：不能静默改变另一间房的归属）
  3. 幂等：重复合并同一对 → already_merged，不产生第二条别名
  4. dry_run 预演与正式执行数字一致（红线③：弹窗所见即所得）
  5. 合并后旧编号仍可查到（红线①：不删数据）
  6. JSON 关联键同步改写 → 再导入旧编号不会让旧设备复活

运行：
  cd inspection-system/backend
  venv/Scripts/python.exe tests/test_room_device_merge.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DISABLE_AUTH"] = "true"
os.environ["DEV_MODE"] = "true"

import database  # 必须在改engine 之前导入

_TMP = tempfile.mkdtemp(prefix="merge_e2e_")
_DB_PATH = os.path.join(_TMP, "test.db")
database.DATABASE_URL = f"sqlite:///{_DB_PATH}"
database.engine = database.create_engine(
    database.DATABASE_URL, connect_args={"check_same_thread": False})
database.SessionLocal = database.sessionmaker(
    autocommit=False, autoflush=False, bind=database.engine)
database.init_db()

from database import (DeviceAlias, Device, Record, DataTable, FieldDef,
                      DeviceRelation, Room, FixedAsset, Subsystem)
from fastapi import FastAPI
from fastapi.testclient import TestClient
import asset_routes
from device_alias_normalizer import resolve_device_code, reset_normalizer

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{extra}]" if extra and not cond else ""))


app = FastAPI()
# asset_routes.router 自带 prefix='/assets'，这里不要再加，否则路径翻倍
app.include_router(asset_routes.router)
client = TestClient(app)
DB = database.SessionLocal

LOCATE = asset_routes._INV_LOCATE_LABEL
REL_KEY = "device_code_field"


def seed():
    """造数据：两间房，每间两台同类设备（各有编号），外加资料表与记录。"""
    reset_normalizer()
    db = DB()
    sub = Subsystem(code="SUB_T", name="测试子系统")
    db.add(sub)
    db.flush()

    r1 = Room(code="GTC-1F-R01", name="测试机房A", building="GTC", floor="1F",
              room_type="机房")
    r2 = Room(code="GTC-2F-R02", name="测试机房B", building="GTC", floor="2F",
              room_type="机房")
    db.add_all([r1, r2])
    db.flush()

    dt = DataTable(name="设备资料表", code="dt_merge_test", subsystem_id=sub.id)
    db.add(dt)
    db.flush()
    db.add(FieldDef(table_id=dt.id, key=REL_KEY, label="设备编号",
                    is_relation_key=True))

    # A 房：KEEP-001 与 OLD-001 是同一台设备（同类项）
    for code, room in (("KEEP-001", r1), ("OLD-001", r1), ("KEEP-002", r2),
                       ("OLD-002", r2)):
        db.add(Device(device_code=code, name=f"设备{code}", subsystem_id=sub.id,
                      room_id=room.id, building=room.building, floor=room.floor))
        db.add(DeviceRelation(from_code=code, to_code=room.code,
                              relation_type=LOCATE, subsystem_id=sub.id))
    # OLD-001 有一条供电关系边 + 一条资料记录（含关联键）
    db.add(DeviceRelation(from_code="OLD-001", to_code="KEEP-002",
                          relation_type="供电"))
    db.add(Record(table_id=dt.id, device_code="OLD-001",
                  data={REL_KEY: "OLD-001", "note": "现场补录"}))
    db.commit()
    return dt.id


def codes_in_room(room_code):
    db = DB()
    room = db.query(Room).filter(Room.code == room_code).first()
    return asset_routes._room_bound_codes(db, room)


def main():
    dt_id = seed()
    print("\n=== 1. 同房间合并成功 ===")
    res = client.post("/assets/rooms/GTC-1F-R01/devices/merge",
                      json={"keep_code": "KEEP-001", "merge_code": "OLD-001",
                            "remark": "现场确认同一台"})
    check("合并返回 200", res.status_code == 200, res.text[:200])
    body = res.json() if res.status_code == 200 else {}
    check("success=True", body.get("success") is True)
    check("规范编号=KEEP-001", body.get("canonical_code") == "KEEP-001")
    check("本房间设备数 2→1", codes_in_room("GTC-1F-R01") == {"KEEP-001"},
          str(codes_in_room("GTC-1F-R01")))
    db = DB()
    al = db.query(DeviceAlias).filter(DeviceAlias.alias_code == "OLD-001").first()
    check("别名已写入", al is not None and al.canonical_code == "KEEP-001")
    check("别名 source=merge", al is not None and al.source == "merge")
    rec = db.query(Record).filter(Record.data.like("%KEEP-001%")).first() \
        if hasattr(Record.data, "like") else None
    db.close()
    db = DB()
    rec = db.query(Record).first()
    check("记录 device_code 已改挂", rec.device_code == "KEEP-001", rec.device_code)
    check("JSON 关联键已同步改写",
          (rec.data or {}).get(REL_KEY) == "KEEP-001", str(rec.data))
    db.close()

    db = DB()
    edge = db.query(DeviceRelation).filter(
        DeviceRelation.from_code == "KEEP-001",
        DeviceRelation.relation_type == "供电").first()
    check("旧编号供电边改指主设备", edge is not None and edge.to_code == "KEEP-002")
    old_loc = db.query(DeviceRelation).filter(
        DeviceRelation.from_code == "OLD-001",
        DeviceRelation.relation_type == LOCATE).count()
    check("旧编号位置边已清理", old_loc == 0, str(old_loc))
    db.close()

    print("\n=== 2. 跨房间合并必须拒绝（红线②）===")
    res = client.post("/assets/rooms/GTC-1F-R01/devices/merge",
                      json={"keep_code": "KEEP-001", "merge_code": "OLD-002"})
    check("跨房间合并返回 409", res.status_code == 409, f"{res.status_code} {res.text[:120]}")
    check("跨房间后旧编号未被合并",
          codes_in_room("GTC-2F-R02") == {"KEEP-002", "OLD-002"})

    print("\n=== 3. 幂等：重复合并 ===")
    res = client.post("/assets/rooms/GTC-1F-R01/devices/merge",
                      json={"keep_code": "KEEP-001", "merge_code": "OLD-001"})
    check("重复合并返回 200", res.status_code == 200, res.text[:150])
    check("标记 already_merged", res.json().get("already_merged") is True)
    db = DB()
    n = db.query(DeviceAlias).filter(DeviceAlias.alias_code == "OLD-001").count()
    check("别名未重复写入", n == 1, str(n))
    db.close()

    print("\n=== 4. dry_run 预演与执行一致（红线③）===")
    res = client.post("/assets/rooms/GTC-2F-R02/devices/merge",
                      json={"keep_code": "KEEP-002", "merge_code": "OLD-002",
                            "dry_run": True})
    check("预演返回 200", res.status_code == 200, res.text[:150])
    plan = res.json().get("plan", {}) if res.status_code == 200 else {}
    check("预演标 dry_run", res.json().get("dry_run") is True)
    check("预演未写库（设备仍2台）",
          codes_in_room("GTC-2F-R02") == {"KEEP-002", "OLD-002"})
    planned = plan.get("records_to_rewrite")
    res2 = client.post("/assets/rooms/GTC-2F-R02/devices/merge",
                       json={"keep_code": "KEEP-002", "merge_code": "OLD-002"})
    check("正式执行成功", res2.status_code == 200, res2.text[:150])
    check("预演数字= 实际改写数",
          res2.json().get("records_rewritten") == planned,
          f"plan={planned} actual={res2.json().get('records_rewritten')}")

    print("\n=== 5. 旧编号仍可查（红线①：不删数据）===")
    db = DB()
    reset_normalizer()
    check("归一把旧编号解析到主设备",
          resolve_device_code(DB(), "OLD-001") == "KEEP-001")
    db.close()
    res = client.get("/assets/rooms/GTC-1F-R01/devices")
    check("房间清单仍可读", res.status_code == 200)
    got = {d["device_code"] for d in res.json().get("devices", [])}
    check("主设备在清单里", "KEEP-001" in got, str(got))

    print("\n=== 6. 合并后再导入旧编号不会复活 ===")
    db = DB()
    db.add(Record(table_id=dt_id, device_code="OLD-001", data={REL_KEY: "OLD-001"}))
    db.commit()
    db.close()
    res = client.post("/assets/rooms/GTC-1F-R01/devices",
                      json={"device_code": "OLD-001"})
    check("用旧编号扫码仍归一到主设备",
          res.status_code == 200 and
          res.json().get("device", {}).get("device_code") == "KEEP-001",
          res.text[:200])

    print("\n=== 7. 参数校验 ===")
    res = client.post("/assets/rooms/GTC-1F-R01/devices/merge",
                      json={"keep_code": "KEEP-001", "merge_code": "KEEP-001"})
    check("同编号合并返回 400", res.status_code == 400, str(res.status_code))
    res = client.post("/assets/rooms/GTC-1F-R01/devices/merge",
                      json={"keep_code": "", "merge_code": "X"})
    check("空编号返回 400", res.status_code == 400, str(res.status_code))
    res = client.post("/assets/rooms/NOT-EXIST/devices/merge",
                      json={"keep_code": "A", "merge_code": "B"})
    check("房间不存在返回 404", res.status_code == 404, str(res.status_code))

    print(f"\n{'=' * 46}\n通过 {len(PASS)} / {len(PASS) + len(FAIL)}")
    if FAIL:
        print("失败项：")
        for f in FAIL:
            print("  - " + f)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
