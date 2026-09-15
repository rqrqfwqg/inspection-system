# -*- coding: utf-8 -*-
"""机身编号现场补录 · 后端自测（批次③ T02 · 可写但仅在 fixture 副本上）

覆盖（《机身编码匹配_技术设计.md》§4.2/§4.3/§4.4/§4.5 + 批次③ T02 验收）：
  ① 幂等：重复提交同 (device_code, serial_norm) → already:true 且行数不变
  ② 冲突比对对象 = 台账 `brand_model` 的**抽取值**（非 serial_no）：
       a) serial_no 不同但抽取值相同 → none ；b) 抽取值不同 → conflicts_ledger
  ③ 冲突时台账 `fixed_assets` 该行逐字节未变（json.dumps sort_keys 比对）
  ④ DELETE 置 rejected 后该编号不再命中（软删，可逆）
  ⑤ 迁移连跑两次幂等 + 三索引齐备 + 部分唯一索引确实拦截
  ⑥ POST 之后**立即**（不 sleep）`/resolve` 精确命中 observation_exact(96) ← 验缓存失效
  ⑦ serial_raw 归一后为空 → 400 ；device_code 不存在 → 404
  ⑧ conflicts_other_device 的观测不并入匹配索引（resolve 不返回那台设备）
  附：审计字段（operator/room_code/note/observed_at/client=X-Client-Type）落库

数据源：**只读 fixture 的副本**（绝不写 `scripts/_online_fixture.db`）。
  --fixture online（默认）：scripts/_online_fixture.db → 复制为 scripts/_obs_test_runtime.db
  --fixture local           ：本工程 app.db 的副本
  --db-url <path>           ：任意 sqlite 的副本
用法（务必用该工程 base python + venv site-packages）：
    python scripts/test_observations.py
"""
import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)

os.environ["DISABLE_AUTH"] = "true"
os.environ.setdefault("DEV_MODE", "true")

FIXTURE_DB = os.path.join(_BACKEND, "scripts", "_online_fixture.db")
LOCAL_DB = os.path.join(_BACKEND, "app.db")
RUNTIME_DB = os.path.join(_BACKEND, "scripts", "_obs_test_runtime.db")
EXPECTED_ONLINE_MERGED = 8977


def parse_args():
    ap = argparse.ArgumentParser(description="机身编号现场补录（observations）自测")
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
    print(f"[fixture=online] 源库合并行数（devices ∪ records ∪ fixed_assets）= {_merged}"
          f"（期望 {EXPECTED_ONLINE_MERGED}）")
    if _merged != EXPECTED_ONLINE_MERGED:
        sys.exit(f"[FATAL] fixture 行数 {_merged} != 期望 {EXPECTED_ONLINE_MERGED}，"
                 "拒绝在不可信数据上跑测试。")

# 关键：**只读源库的副本**——绝不写 _online_fixture.db / app.db
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
from sqlalchemy.exc import IntegrityError  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
import database  # noqa: E402
import asset_code_match as acm  # noqa: E402
import asset_ledger_routes as alr  # noqa: E402
import migrate_asset_schema as mig  # noqa: E402  (import 在 _inject_db 之后 → 绑到副本引擎)
from database import FixedAsset, DeviceSerialObservation, SessionLocal  # noqa: E402

P = "/ops/api/assets"
OBS = f"{P}/asset-ledger/observations"
RESOLVE = f"{P}/asset-ledger/resolve"

# ground truth（由 _probe_obs.py 从线上 fixture 只读核实）
D = "105000620952"          # source=devices；brand_model='白云电器，配电箱 G-1D9APt' → 抽取 'G-1D9APt'
B_OBS = "105000621392"      # source=devices（用于 ⑧a 跨设备「观测」分支）
B_LED = "105000625413"      # source=devices，且台账抽不出机身编号（用于 ⑧b 跨设备「抽取」分支）
D_CLEAN = "105000625413"    # = B_LED：台账抽不出机身编号 → 补录天然 none（干净设备）
LED_OCCUPIED_BY = "105000615032"  # brand_model 抽取 'C69E-1'（占用者，用于 ⑧b 前置）

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


def _active_rows(s, code, norm):
    return (s.query(DeviceSerialObservation)
            .filter(DeviceSerialObservation.device_code == code,
                    DeviceSerialObservation.serial_norm == norm,
                    DeviceSerialObservation.status == "active").all())


def _resolve(c, q):
    r = c.get(RESOLVE, params={"q": q})
    return r.status_code, r.json()


def _has(d, code=None, mtype=None):
    for x in (d.get("candidates") or []):
        if code is not None and x.get("device_code") != code:
            continue
        if mtype is not None and x.get("match_type") != mtype:
            continue
        return True
    return False


def _dso_indexes():
    with database.engine.begin() as conn:
        return {r[0] for r in conn.execute(sa_text(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
            " AND tbl_name = 'device_serial_observations'")).all()}


# ============================================================ ⑤ 迁移幂等
def run_migration_checks():
    print("=" * 78)
    print("⑤ 迁移：建表 + 部分唯一索引（幂等：连跑两次）")
    try:
        mig.create_new_tables()
        mig.migrate_device_serial_observations()
        first_ok = True
    except Exception as e:  # noqa: BLE001
        first_ok = False
        print(f"  [mig] 第一次异常：{e!r}")
    table_ok = sa_inspect(database.engine).has_table("device_serial_observations")
    idx1 = _dso_indexes()
    try:
        mig.migrate_device_serial_observations()   # 第二次
        second_ok = True
    except Exception as e:  # noqa: BLE001
        second_ok = False
        print(f"  [mig] 第二次异常：{e!r}")
    idx2 = _dso_indexes()

    check("⑤ 第一次迁移无异常", first_ok)
    check("⑤ 迁移后表 device_serial_observations 存在", table_ok)
    check("⑤ 三索引齐备（ux_dso_device_serial / ix_dso_serial_norm / ix_dso_device）",
          {"ux_dso_device_serial", "ix_dso_serial_norm", "ix_dso_device"} <= idx1,
          f"idx={sorted(idx1)}")
    check("⑤ 第二次执行不报错（幂等）", second_ok)
    check("⑤ 二次执行后索引集合不变", idx1 == idx2, f"{sorted(idx1)} == {sorted(idx2)}")

    # 部分唯一索引（WHERE status='active'）确实拦截重复 active 行
    raised = False
    try:
        with database.engine.begin() as conn:
            conn.execute(sa_text(
                "INSERT INTO device_serial_observations"
                "(device_code, serial_raw, serial_norm, status)"
                " VALUES ('__IDX_TEST__', 'Z-9', 'Z9', 'active')"))
            conn.execute(sa_text(
                "INSERT INTO device_serial_observations"
                "(device_code, serial_raw, serial_norm, status)"
                " VALUES ('__IDX_TEST__', 'Z-9', 'Z9', 'active')"))
    except IntegrityError:
        raised = True
    check("⑤ 部分唯一索引拦截同 (device, serial_norm) 重复 active 行", raised)
    # 事务已回滚 → 不留痕
    with database.engine.begin() as conn:
        left = conn.execute(sa_text(
            "SELECT COUNT(*) FROM device_serial_observations"
            " WHERE device_code = '__IDX_TEST__'")).scalar()
    check("⑤ 幂等探测事务已回滚（未污染表）", left == 0, f"left={left}")


def main():
    run_migration_checks()

    with TestClient(app) as c:
        # ---------------- ① 幂等 ----------------
        print("=" * 78)
        print("① 幂等：重复提交同 (device_code, serial_norm)")
        v1 = "OBS-DUP-7G8H9I"
        n1 = acm.normalize_code(v1)["loose"]
        s = _sess(); before1 = len(_active_rows(s, D_CLEAN, n1)); s.close()
        r1 = c.post(OBS, json={"device_code": D_CLEAN, "serial_raw": v1, "operator": "tester"})
        d1 = r1.json()
        print(f"  首次 POST -> {json.dumps(d1, ensure_ascii=False)}")
        check("① 首次提交 200 且 already=False", r1.status_code == 200 and d1.get("already") is False,
              f"code={r1.status_code} already={d1.get('already')}")
        check("① 首次 conflict_state=none", d1.get("conflict_state") == "none",
              f"= {d1.get('conflict_state')}")
        check("① 响应 serial_norm == normalize_code(loose)", d1.get("serial_norm") == n1,
              f"= {d1.get('serial_norm')!r} vs {n1!r}")
        r2 = c.post(OBS, json={"device_code": D_CLEAN, "serial_raw": v1})
        d2 = r2.json()
        print(f"  再次 POST -> {json.dumps(d2, ensure_ascii=False)}")
        s = _sess(); after1 = _active_rows(s, D_CLEAN, n1); s.close()
        check("① 重复提交 200 且 already=True", r2.status_code == 200 and d2.get("already") is True,
              f"code={r2.status_code} already={d2.get('already')}")
        check("① 幂等：id 与首次一致（未新建）", d2.get("id") == d1.get("id"),
              f"{d2.get('id')} vs {d1.get('id')}")
        check("① 幂等：active 行数不变（0→1，重复后仍 1）",
              before1 == 0 and len(after1) == 1, f"before={before1} after={len(after1)}")

        # ---------------- ⑥ 缓存失效（立即命中，不 sleep）----------------
        print("=" * 78)
        print("⑥ 缓存失效：POST 后**立即** resolve 命中 observation_exact(96)")
        _resolve(c, D)  # 先热身缓存（此时索引已建、不含新观测）
        v6 = "OBS-CACHE-1A2B3C"
        r = c.post(OBS, json={"device_code": D, "serial_raw": v6, "operator": "tester"})
        check("⑥ POST 200 且新建", r.status_code == 200 and r.json().get("already") is False,
              f"code={r.status_code}")
        sc, dd = _resolve(c, v6)   # ← 立即，绝不 sleep
        top = (dd.get("candidates") or [{}])[0]
        print(f"  立即 resolve({v6!r}) -> kind={dd.get('kind')} top={top.get('match_type')}"
              f"/{top.get('confidence')}/{top.get('device_code')}")
        check("⑥ 补录后立即命中 observation_exact/96（缓存已失效，未 sleep）",
              dd.get("kind") == "serial" and top.get("match_type") == "observation_exact"
              and top.get("confidence") == 96 and top.get("device_code") == D,
              f"kind={dd.get('kind')} top={top.get('match_type')}/{top.get('confidence')}")

        # ---------------- ② 冲突比对对象 = 抽取值（非 serial_no）----------------
        print("=" * 78)
        print("② 冲突比对对象 = 台账 brand_model 抽取值（非 serial_no）")
        s = _sess()
        fa = s.query(FixedAsset).filter(FixedAsset.device_code == D).first()
        bm = (fa.brand_model or "") if fa else ""
        sn = (fa.serial_no or "") if fa else ""
        s.close()
        led = acm.extract_serial_from_brand(bm)
        print(f"  台账 brand_model={bm!r} → 抽取={led!r}；serial_no={sn!r}")
        check("② 前置：该设备台账抽取值非空", bool(led), f"extract={led!r}")
        check("② 前置：抽取值 loose ≠ serial_no loose（故比对对象必非 serial_no）",
              acm.normalize_code(led)["loose"] != acm.normalize_code(sn)["loose"],
              f"loose(extract)={acm.normalize_code(led)['loose']!r} "
              f"loose(serial_no)={acm.normalize_code(sn)['loose']!r}")

        r = c.post(OBS, json={"device_code": D, "serial_raw": led})
        d = r.json()
        print(f"  ②a 提交=抽取值 -> conflict_state={d.get('conflict_state')}")
        check("②a serial_no 不同但提交值=抽取值 → conflict_state=none",
              r.status_code == 200 and d.get("conflict_state") == "none",
              f"= {d.get('conflict_state')}")

        r = c.post(OBS, json={"device_code": D, "serial_raw": "OBS-LEDGER-MISMATCH-K3"})
        d = r.json()
        print(f"  ②b 提交≠抽取值 -> conflict_state={d.get('conflict_state')} "
              f"conflict={json.dumps(d.get('conflict'), ensure_ascii=False)}")
        check("②b 提交值≠抽取值 → conflict_state=conflicts_ledger",
              r.status_code == 200 and d.get("conflict_state") == "conflicts_ledger",
              f"= {d.get('conflict_state')}")
        check("②b 响应带 conflict.type=conflicts_ledger（HTTP 仍 200）",
              r.status_code == 200 and (d.get("conflict") or {}).get("type") == "conflicts_ledger",
              f"code={r.status_code}")

        r = c.post(OBS, json={"device_code": D_CLEAN, "serial_raw": "OBS-NOLED-2Z3Y4X"})
        d = r.json()
        print(f"  ②c 台账抽不出，提交任意值 -> conflict_state={d.get('conflict_state')}")
        check("②c 台账抽不出机身编号 → 接受且 conflict_state=none",
              r.status_code == 200 and d.get("conflict_state") == "none",
              f"= {d.get('conflict_state')}")

        # ---------------- ③ 冲突时台账逐字节未变 ----------------
        print("=" * 78)
        print("③ 冲突提交前后 fixed_assets 该行逐字节未变")
        s = _sess(); before3 = _fa_dump(s, D); s.close()
        r = c.post(OBS, json={"device_code": D, "serial_raw": "OBS-CONFLICT-BYTE-K3"})
        d = r.json()
        s = _sess(); after3 = _fa_dump(s, D); s.close()
        check("③ 该次确为冲突（conflicts_ledger）",
              r.status_code == 200 and d.get("conflict_state") == "conflicts_ledger",
              f"= {d.get('conflict_state')}")
        check("③ 台账该行 json.dumps(sort_keys) 前后一致",
              before3 is not None and before3 == after3,
              f"len(before)={len(before3 or '')} len(after)={len(after3 or '')}")

        # ---------------- ④ DELETE 后不再命中 ----------------
        print("=" * 78)
        print("④ DELETE（软删 rejected）后该编号不再命中")
        v4 = "OBS-DEL-4D5E6F"
        r = c.post(OBS, json={"device_code": D, "serial_raw": v4})
        d4 = r.json()
        oid = d4.get("id")
        sc, dd = _resolve(c, v4)
        check("④ 删除前 resolve 命中 observation_exact/96", _has(dd, D, "observation_exact"),
              f"cands={[x.get('device_code') for x in (dd.get('candidates') or [])]}")
        r = c.delete(f"{OBS}/{oid}")
        check("④ DELETE 200 且 status=rejected",
              r.status_code == 200 and r.json().get("status") == "rejected",
              f"code={r.status_code} body={r.text[:80]}")
        s = _sess()
        row = s.query(DeviceSerialObservation).filter(DeviceSerialObservation.id == oid).first()
        st = row.status if row else None
        s.close()
        check("④ 软删不物理删除（行仍在，status=rejected）", st == "rejected", f"= {st}")
        sc, dd = _resolve(c, v4)
        print(f"  删除后 resolve({v4!r}) -> kind={dd.get('kind')} "
              f"cands={[x.get('device_code') for x in (dd.get('candidates') or [])]}")
        check("④ 删除后该编号不再命中（无 observation_exact）",
              not _has(dd, None, "observation_exact"))
        check("④ 删除后不返回该设备", not _has(dd, D))

        # ---------------- ⑦ 400 / 404 ----------------
        print("=" * 78)
        print("⑦ 参数校验：serial_raw 归一后为空 → 400；device_code 不存在 → 404")
        r = c.post(OBS, json={"device_code": D, "serial_raw": "---"})
        check("⑦ serial_raw 归一后为空 → 400", r.status_code == 400, f"code={r.status_code}")
        r = c.post(OBS, json={"device_code": "__NO_SUCH_DEVICE__", "serial_raw": "ABC123"})
        check("⑦ device_code 不存在 → 404", r.status_code == 404, f"code={r.status_code}")

        # ---------------- ⑧ conflicts_other_device 不并入索引 ----------------
        print("=" * 78)
        print("⑧ conflicts_other_device：跨设备冲突 → 隔离，不并入匹配索引")
        # ⑧a 「其他设备 active 观测」分支
        vA = "OBS-XD-9X8Y7"
        nA = acm.normalize_code(vA)["loose"]
        r = c.post(OBS, json={"device_code": D_CLEAN, "serial_raw": vA})
        check("⑧a A 首次补录 none", r.status_code == 200 and r.json().get("conflict_state") == "none",
              f"= {r.json().get('conflict_state')}")
        r = c.post(OBS, json={"device_code": B_OBS, "serial_raw": vA})
        d = r.json()
        print(f"  B({B_OBS}) 提交同编号 -> conflict_state={d.get('conflict_state')}")
        check("⑧a B 提交同编号 → conflicts_other_device",
              r.status_code == 200 and d.get("conflict_state") == "conflicts_other_device",
              f"= {d.get('conflict_state')}")
        s = _sess()
        brow = (s.query(DeviceSerialObservation)
                .filter(DeviceSerialObservation.device_code == B_OBS,
                        DeviceSerialObservation.serial_norm == nA).first())
        bst = brow.status if brow else None
        s.close()
        check("⑧a 隔离行落库 status=quarantined（内核只并 active）", bst == "quarantined", f"= {bst}")
        sc, dd = _resolve(c, vA)
        print(f"  resolve({vA!r}) -> cands={[x.get('device_code') for x in (dd.get('candidates') or [])]}")
        check("⑧a 隔离行不并入索引：resolve 不返回 B", not _has(dd, B_OBS))
        check("⑧a 仍返回 A（其 active 观测）", _has(dd, D_CLEAN, "observation_exact"))

        # ⑧b 「其他设备 brand_model 抽取值」分支
        vB2 = "C69E-1"
        sc, pre = _resolve(c, vB2)
        check(f"⑧b 前置：该编号当前由他机台账抽取命中（{LED_OCCUPIED_BY}/brand_extract_exact）",
              _has(pre, LED_OCCUPIED_BY, "brand_extract_exact"),
              f"cands={[x.get('device_code') for x in (pre.get('candidates') or [])]}")
        r = c.post(OBS, json={"device_code": B_LED, "serial_raw": vB2})
        d = r.json()
        print(f"  {B_LED}(台账抽不出) 提交他机抽取值 -> conflict_state={d.get('conflict_state')}")
        check("⑧b 编号被他机台账抽取值占用 → conflicts_other_device",
              r.status_code == 200 and d.get("conflict_state") == "conflicts_other_device",
              f"= {d.get('conflict_state')}")
        sc, dd = _resolve(c, vB2)
        check("⑧b 隔离行不并入索引：resolve 不返回 B2", not _has(dd, B_LED))

        # ---------------- 附：审计字段 + GET ----------------
        print("=" * 78)
        print("附：审计字段落库 + GET 查询")
        r = c.post(OBS, json={"device_code": D, "serial_raw": "OBS-AUDIT-1",
                              "operator": "严梓健", "room_code": "J1W-2F-203",
                              "observed_at": "2026-09-11T08:31:00Z", "note": "铭牌磨损"},
                   headers={"X-Client-Type": "web"})
        da = r.json()
        s = _sess()
        row = s.query(DeviceSerialObservation).filter(DeviceSerialObservation.id == da.get("id")).first()
        audit = (row.operator, row.room_code, row.note, row.client) if row else None
        oa = row.observed_at if row else None
        s.close()
        check("附 审计字段落库（operator/room_code/note）",
              audit is not None and audit[:3] == ("严梓健", "J1W-2F-203", "铭牌磨损"), f"= {audit}")
        check("附 X-Client-Type 记入 client 字段", audit is not None and audit[3] == "web", f"= {audit}")
        check("附 observed_at 解析为 datetime", isinstance(oa, datetime), f"= {oa!r}")

        r = c.get(OBS, params={"device_code": D})
        body = r.json()
        check("附 GET 默认仅返回 active",
              r.status_code == 200 and all(x.get("status") == "active" for x in body),
              f"n={len(body)}")
        r = c.get(OBS, params={"device_code": D, "status": "rejected"})
        body = r.json()
        check("附 GET ?status=rejected 可查软删行",
              r.status_code == 200 and len(body) >= 1
              and all(x.get("status") == "rejected" for x in body),
              f"n={len(body)}")

        # ---------------- ⑨ 历史 NULL 行的兼容（回归 2026-09-15 线上 500） ----------------
        print("=" * 78)
        print("⑨ 兼容历史行：字符串列 NULL 时 GET 归一为默认值（回归线上 500）")
        with database.engine.begin() as conn:
            conn.execute(sa_text(
                "INSERT INTO device_serial_observations"
                " (device_code, serial_raw, serial_norm, status, operator, source,"
                "  client, conflict_state, ledger_brand_serial, note)"
                " VALUES (:c, 'NULLROW-1', 'nullrow1', 'active', NULL, NULL,"
                "  NULL, NULL, NULL, NULL)"), {"c": D})
        r = c.get(OBS, params={"device_code": D})
        check("⑨ 含 NULL 字符串列的行：GET 不再 500", r.status_code == 200,
              f"status={r.status_code}")
        rows = r.json() if r.status_code == 200 else []
        nr = [x for x in rows if x.get("serial_norm") == "nullrow1"]
        check("⑨ NULL 归一为字符串默认值（client/status/conflict_state/note）",
              bool(nr) and nr[0].get("client") == "miniprogram"
              and nr[0].get("status") == "active"
              and nr[0].get("conflict_state") == "none"
              and nr[0].get("note") == "" and nr[0].get("operator") == ""
              and nr[0].get("source") == "miniprogram",
              f"= {nr[0] if nr else None}")

    print("=" * 78)
    print(f"===== 结果: PASS={passed}  FAIL={failed} =====")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
