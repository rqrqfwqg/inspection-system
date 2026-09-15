# -*- coding: utf-8 -*-
"""设备现场定位观测（批次⑤ · 扫码即记坐标）· 后端自测

覆盖：
  ① 迁移：`device_geo_observations` 建表 + device_code / created_at 索引（幂等：连跑两次）
  ② POST 正常：合法坐标落库，审计字段完整
     （accuracy / coord_type / room_code / scan_source / operator / client / observed_at）
  ③ **每次扫码一条**（刻意不做幂等）：同设备同坐标连提两次 → 两行、id 不同
  ④ 400：device_code 为空 / 经纬度缺失 / 纬度超范围 / 经度超范围 / 坐标为 (0,0)
  ⑤ 404：device_code 不在台账
  ⑥ GET：按 device_code 查询 → **倒序**（最新在前）、limit 生效
  ⑦ GET 缺省（不带 device_code）→ 返回最近 N 条且不报错
  ⑧ 只写观测不改台账：提交前后 `fixed_assets` 该行 JSON 逐字节不变

数据源：**只读 fixture 的副本**（绝不写 `scripts/_online_fixture.db` / `app.db`）。
用法（务必用该工程 base python + venv site-packages）：
    python scripts/test_geo_observations.py
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

os.environ["DISABLE_AUTH"] = "true"
os.environ.setdefault("DEV_MODE", "true")

FIXTURE_DB = os.path.join(_BACKEND, "scripts", "_online_fixture.db")
LOCAL_DB = os.path.join(_BACKEND, "app.db")
RUNTIME_DB = os.path.join(_BACKEND, "scripts", "_geo_test_runtime.db")
EXPECTED_ONLINE_MERGED = 8977


def parse_args():
    ap = argparse.ArgumentParser(description="设备现场定位观测（geo-observations）自测")
    ap.add_argument("--fixture", choices=["online", "local"], default="online",
                    help="online=线上 fixture 副本（默认）；local=本机 app.db 副本")
    ap.add_argument("--db-url", default=None, help="显式指定 sqlite 源库文件路径")
    return ap.parse_args()


def _merged_count(db_path):
    con = sqlite3.connect(db_path)
    try:
        return con.execute(
            "SELECT COUNT(*) FROM (SELECT device_code FROM devices"
            " UNION SELECT device_code FROM records WHERE device_code IS NOT NULL AND device_code<>''"
            " UNION SELECT device_code FROM fixed_assets)").fetchone()[0]
    finally:
        con.close()


ARGS = parse_args()
if ARGS.db_url:
    MODE = "custom"
    SRC = os.path.abspath(ARGS.db_url)
elif ARGS.fixture == "online":
    MODE = "online"
    SRC = FIXTURE_DB
else:
    MODE = "local"
    SRC = LOCAL_DB

print("=" * 78)
print(f"[fixture={MODE}] 源库 = {SRC}")
if not os.path.exists(SRC):
    sys.exit(f"[FATAL] 源库不存在：{SRC}")
if MODE == "online":
    _merged = _merged_count(SRC)
    print(f"[fixture=online] 源库合并行数 = {_merged}（期望 {EXPECTED_ONLINE_MERGED}）")
    if _merged != EXPECTED_ONLINE_MERGED:
        sys.exit(f"[FATAL] fixture 行数 {_merged} != 期望 {EXPECTED_ONLINE_MERGED}，"
                 "拒绝在不可信数据上跑测试。")

shutil.copy2(SRC, RUNTIME_DB)
print(f"[fixture={MODE}] 已在副本上操作 = {RUNTIME_DB}（源库只读，未被写入）")


def _inject_db(db_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import database
    url = "sqlite:///" + os.path.abspath(db_path).replace("\\", "/")
    engine = create_engine(url, connect_args={"check_same_thread": False})
    database.DATABASE_URL = url
    database.engine = engine
    database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return url


_DB_URL = _inject_db(RUNTIME_DB)

from sqlalchemy import text as sa_text  # noqa: E402
from sqlalchemy import inspect as sa_inspect  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
import database  # noqa: E402
import migrate_asset_schema as mig  # noqa: E402   (import 在 _inject_db 之后 → 绑到副本引擎)
from database import FixedAsset, DeviceGeoObservation, SessionLocal  # noqa: E402

P = "/ops/api/assets"
GEO = f"{P}/asset-ledger/geo-observations"

# ground truth（fixture 中真实存在的设备）
D = "105000620952"            # source=devices；brand_model='白云电器，配电箱 G-1D9APt'
D2 = "105000621392"           # source=devices（用于倒序/多条验证）
GHOST = "__NO_SUCH_DEVICE_9x__"

passed = 0
failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  [PASS] {name} {extra}")
    else:
        failed += 1
        print(f"  [FAIL] {name} {extra}")


def _sess():
    return SessionLocal()


def _fa_dump(s, code):
    fa = s.query(FixedAsset).filter(FixedAsset.device_code == code).first()
    if fa is None:
        return None
    return json.dumps({c.name: str(getattr(fa, c.name)) for c in FixedAsset.__table__.columns},
                      ensure_ascii=False, sort_keys=True)


def _geo_indexes():
    with database.engine.begin() as conn:
        return {r[0] for r in conn.execute(sa_text(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
            " AND tbl_name = 'device_geo_observations'")).all()}


def post(payload, client_type="miniprogram"):
    c = TestClient(app)
    headers = {"X-Client-Type": client_type} if client_type else {}
    return c.post(GEO, json=payload, headers=headers)


def get(params):
    return TestClient(app).get(GEO, params=params)


def payload(**over):
    base = {
        "device_code": D,
        "latitude": 22.123456,
        "longitude": 113.456789,
        "accuracy": 12.5,
        "coord_type": "gcj02",
        "room_code": "P12N-2F-JQS-105",
        "scan_source": "camera",
        "operator": "测试员",
        "observed_at": "2026-09-15T09:00:00+08:00",
    }
    base.update(over)
    for k, v in list(over.items()):
        if v is None:
            base.pop(k, None)      # None = 从 payload 中移除该键
    return base


# ============================================================ ① 迁移
def run_migration_checks():
    print("=" * 78)
    print("① 迁移：建表 + 索引（幂等：连跑两次）")
    c1 = TestClient(app)
    try:
        mig.create_new_tables()
        ok1 = True
    except Exception as e:  # noqa: BLE001
        ok1 = False
        print(f"  [mig] 第一次异常：{e!r}")
    table_ok = sa_inspect(database.engine).has_table("device_geo_observations")
    idx1 = _geo_indexes()
    try:
        mig.create_new_tables()      # 第二次
        ok2 = True
    except Exception as e:  # noqa: BLE001
        ok2 = False
        print(f"  [mig] 第二次异常：{e!r}")
    idx2 = _geo_indexes()

    check("① 第一次迁移无异常", ok1)
    check("① 表 device_geo_observations 存在", table_ok)
    check("① device_code 索引存在",
          "ix_device_geo_observations_device_code" in idx1, f"idx={sorted(idx1)}")
    check("① created_at 索引存在",
          "ix_device_geo_observations_created_at" in idx1, f"idx={sorted(idx1)}")
    check("① 第二次执行不报错（幂等）", ok2)
    check("① 二次执行后索引集合不变", idx1 == idx2)
    del c1


# ============================================================ ② POST 正常
def run_create_normal():
    print("=" * 78)
    print("② POST 正常：落库 + 审计字段完整")
    s0 = _sess()
    before = _fa_dump(s0, D)
    s0.close()

    r = post(payload())
    j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    check("② 状态码 200", r.status_code == 200, f"got {r.status_code} {r.text[:120]}")
    check("② success=true", j.get("success") is True)
    check("② created=true", j.get("created") is True)
    check("② 返回 id > 0", isinstance(j.get("id"), int) and j["id"] > 0, f"id={j.get('id')}")
    check("② device_code 回显一致", j.get("device_code") == D)
    new_id = j.get("id")

    s = _sess()
    row = s.query(DeviceGeoObservation).filter(DeviceGeoObservation.id == new_id).first()
    check("② 行已落库", row is not None)
    if row is not None:
        check("② latitude 落库", abs(float(row.latitude) - 22.123456) < 1e-9, f"{row.latitude}")
        check("② longitude 落库", abs(float(row.longitude) - 113.456789) < 1e-9, f"{row.longitude}")
        check("② accuracy 落库", row.accuracy is not None and abs(float(row.accuracy) - 12.5) < 1e-6,
              f"{row.accuracy}")
        check("② coord_type 落库", row.coord_type == "gcj02", f"{row.coord_type}")
        check("② room_code 落库", row.room_code == "P12N-2F-JQS-105", f"{row.room_code}")
        check("② scan_source 落库", row.scan_source == "camera", f"{row.scan_source}")
        check("② operator 落库", row.operator == "测试员", f"{row.operator}")
        check("② source 落库", row.source == "miniprogram", f"{row.source}")
        check("② client 取 X-Client-Type", row.client == "miniprogram", f"{row.client}")
        check("② observed_at 已解析", row.observed_at is not None, f"{row.observed_at}")
        check("② created_at 自动写入", row.created_at is not None)

    after = _fa_dump(s, D)
    s.close()
    check("⑧ 台账 fixed_assets 该行未被改动", before == after)
    return new_id


# ============================================================ ③ 每次一条
def run_no_idempotent(first_id):
    print("=" * 78)
    print("③ 每次扫码一条（刻意不做幂等合并）")
    r2 = post(payload())
    j2 = r2.json()
    check("③ 同设备同坐标再提一次仍 200", r2.status_code == 200, f"got {r2.status_code}")
    check("③ 返回新 id（与首次不同）", j2.get("id") != first_id,
          f"first={first_id} second={j2.get('id')}")
    check("③ 不返回 already 标记（本表无幂等语义）", "already" not in j2, f"keys={sorted(j2)}")

    s = _sess()
    n = s.query(DeviceGeoObservation).filter(DeviceGeoObservation.device_code == D).count()
    s.close()
    check("③ 同设备行数 = 2（两次扫码两条历史）", n == 2, f"count={n}")


# ============================================================ ④⑤ 校验与 404
def run_validation():
    print("=" * 78)
    print("④ 参数校验（400） / ⑤ 设备不存在（404）")

    r = post(payload(device_code=""))
    check("④ device_code 为空 → 400", r.status_code == 400, f"got {r.status_code}")

    r = post(payload(latitude=None))
    check("④ latitude 缺失 → 400/422", r.status_code in (400, 422), f"got {r.status_code}")

    r = post(payload(latitude=91.0))
    check("④ latitude=91 超范围 → 400", r.status_code == 400,
          f"got {r.status_code} {r.text[:80]}")

    r = post(payload(longitude=181.0))
    check("④ longitude=181 超范围 → 400", r.status_code == 400,
          f"got {r.status_code} {r.text[:80]}")

    r = post(payload(latitude=0.0, longitude=0.0))
    check("④ (0,0) 视为无效定位 → 400", r.status_code == 400,
          f"got {r.status_code} {r.text[:80]}")

    r = post(payload(device_code=GHOST))
    check("⑤ 设备不在台账 → 404", r.status_code == 404,
          f"got {r.status_code} {r.text[:80]}")


# ============================================================ ⑥⑦ GET
def run_list():
    print("=" * 78)
    print("⑥ GET 倒序 + limit / ⑦ GET 缺省")
    # 再给 D2 造两条，制造时间差
    post(payload(device_code=D2, latitude=22.2, longitude=113.5))
    post(payload(device_code=D2, latitude=22.3, longitude=113.6))

    r = get({"device_code": D})
    check("⑥ 状态码 200", r.status_code == 200, f"got {r.status_code}")
    rows = r.json()
    check("⑥ 返回 list", isinstance(rows, list), f"type={type(rows).__name__}")
    check("⑥ 只返回该设备的行", all(x["device_code"] == D for x in rows), f"n={len(rows)}")
    check("⑥ 行数 = 2", len(rows) == 2, f"n={len(rows)}")
    if len(rows) >= 2:
        check("⑥ 倒序（最新在前，按 id 降序）", rows[0]["id"] > rows[1]["id"],
              f"{rows[0]['id']} > {rows[1]['id']}")
    if rows:
        check("⑥ 字段回显坐标", "latitude" in rows[0] and "longitude" in rows[0],
              f"keys={sorted(rows[0])[:6]}")

    r = get({"device_code": D, "limit": 1})
    check("⑥ limit=1 生效", len(r.json()) == 1, f"n={len(r.json())}")

    r = get({})
    check("⑦ 不带 device_code 也 200", r.status_code == 200, f"got {r.status_code}")
    check("⑦ 缺省返回非空", len(r.json()) >= 1, f"n={len(r.json())}")


# ============================================================ 清理
def cleanup():
    print("=" * 78)
    print("清理：删除本次测试在副本上留下的行")
    s = _sess()
    n = (s.query(DeviceGeoObservation)
         .filter(DeviceGeoObservation.device_code.in_([D, D2])).delete(synchronize_session=False))
    s.commit()
    left = s.query(DeviceGeoObservation).count()
    s.close()
    print(f"  已删除 {n} 行；表内剩余 {left} 行")
    check("⑨ 清理后表内无残留", left == 0, f"left={left}")


if __name__ == "__main__":
    run_migration_checks()
    first = run_create_normal()
    run_no_idempotent(first)
    run_validation()
    run_list()
    cleanup()
    print("=" * 78)
    print(f"结果：PASS={passed}  FAIL={failed}")
    print("=" * 78)
    sys.exit(1 if failed else 0)
