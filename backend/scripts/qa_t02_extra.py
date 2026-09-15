# -*- coding: utf-8 -*-
"""QA T02 · 白盒补充：直接观测缓存失效标志 / 隔离行不并入索引 / already 路径无副作用。

D) 直接断言 alr._MATCH_INDEX / _ALL_CACHE 在 POST、DELETE 后 key 被清空（==None）。
E) 隔离(quarantined)行即便触发缓存重建也不会并入索引。
① already=True 不再新建、不改行。
只写副本，源 fixture 只读。
"""
import os
import shutil
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)
os.environ["DISABLE_AUTH"] = "true"
os.environ.setdefault("DEV_MODE", "true")

SRC = os.path.join(_HERE, "_online_fixture.db")
RT = os.path.join(_HERE, "qa_t02_runtime2.db")
shutil.copy2(SRC, RT)

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
import database  # noqa: E402

url = "sqlite:///" + RT.replace("\\", "/")
database.DATABASE_URL = url
database.engine = create_engine(url, connect_args={"check_same_thread": False})
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
import asset_code_match as acm  # noqa: E402
import asset_ledger_routes as alr  # noqa: E402
from database import DeviceSerialObservation, SessionLocal  # noqa: E402

OBS = "/ops/api/assets/asset-ledger/observations"
RESOLVE = "/ops/api/assets/asset-ledger/resolve"

passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {extra}")


D = "105000620952"
B_OBS = "105000621392"
B_LED = "105000625413"

print("=== 白盒：缓存失效标志 ===")
with TestClient(app) as c:
    # 热身 → key 变 'all'
    c.get(RESOLVE, params={"q": D})
    warm = alr._MATCH_INDEX["key"]
    check("热身 resolve 后 _MATCH_INDEX.key == 'all'", warm == "all", f"= {warm!r}")

    # POST 新建 → 立即 key 清空
    v = "QA-T02-WB-CACHE-1"
    r = c.post(OBS, json={"device_code": B_LED, "serial_raw": v})
    chk_key = alr._MATCH_INDEX["key"]
    chk_ts = alr._MATCH_INDEX["ts"]
    chk_all = alr._ALL_CACHE["key"]
    check("POST 后立即 _MATCH_INDEX.key is None（主动失效，未等 TTL）",
          chk_key is None and chk_ts == 0.0, f"key={chk_key!r} ts={chk_ts}")
    check("POST 后立即 _ALL_CACHE.key is None", chk_all is None, f"= {chk_all!r}")

    # 再次 resolve → 重建，key 回 'all' 且含新观测
    d = c.get(RESOLVE, params={"q": v}).json()
    check("重建后 _MATCH_INDEX.key == 'all'", alr._MATCH_INDEX["key"] == "all")
    top = (d.get("candidates") or [{}])[0]
    check("重建后命中 observation_exact/96",
          top.get("match_type") == "observation_exact" and top.get("confidence") == 96,
          f"= {top.get('match_type')}/{top.get('confidence')}")

    oid = r.json().get("id")
    c.get(RESOLVE, params={"q": D})            # 再热身
    c.delete(f"{OBS}/{oid}")
    check("DELETE 后立即 _MATCH_INDEX.key is None", alr._MATCH_INDEX["key"] is None,
          f"= {alr._MATCH_INDEX['key']!r}")

print("=== 隔离行（quarantined）即便缓存重建也不并入索引 ===")
with TestClient(app) as c:
    vA = "QA-T02-WB-XD-1"
    c.post(OBS, json={"device_code": B_LED, "serial_raw": vA})       # A active
    c.post(OBS, json={"device_code": B_OBS, "serial_raw": vA})       # B quarantined
    c.get(RESOLVE, params={"q": D})                                   # 触发一次重建
    d = c.get(RESOLVE, params={"q": vA}).json()
    codes = [x.get("device_code") for x in (d.get("candidates") or [])]
    check("重建后 resolve 仍不返回隔离设备 B", B_OBS not in codes, f"cands={codes}")
    check("重建后仍返回 A", B_LED in codes, f"cands={codes}")

print("=== already=True 路径无副作用 ===")
with TestClient(app) as c:
    v2 = "QA-T02-WB-DUP-1"
    r1 = c.post(OBS, json={"device_code": B_LED, "serial_raw": v2})
    id1 = r1.json().get("id")
    r2 = c.post(OBS, json={"device_code": B_LED, "serial_raw": v2})
    check("重复 POST already=True 且 id 相同",
          r2.json().get("already") is True and r2.json().get("id") == id1,
          f"id {id1} -> {r2.json().get('id')}")
    s = SessionLocal()
    n = s.query(DeviceSerialObservation).filter(
        DeviceSerialObservation.device_code == B_LED,
        DeviceSerialObservation.serial_norm == acm.normalize_code(v2)["loose"],
        DeviceSerialObservation.status == "active").count()
    s.close()
    check("重复 POST 后仅 1 条 active 行", n == 1, f"n={n}")

print()
print(f"===== 白盒补充: PASS={passed}  FAIL={failed} =====")
sys.exit(1 if failed else 0)
