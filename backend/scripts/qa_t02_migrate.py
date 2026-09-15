# -*- coding: utf-8 -*-
"""QA T02 · 独立复核 A) 迁移幂等 + 部分唯一索引 + IntegrityError 证明。

在 fixture 的**副本**上从零建表（源 fixture 无 device_serial_observations），
执行迁移两次验证幂等；并独立证明 partial unique index 只约束 active 行。
绝不触碰 _online_fixture.db / app.db。
"""
import hashlib
import os
import shutil
import sqlite3
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

SRC = os.path.join(_HERE, "_online_fixture.db")
COPY = os.path.join(_HERE, "qa_t02_mig.db")
DSO = "device_serial_observations"


def _ro(p):
    return sqlite3.connect(f"file:{p}?mode=ro", uri=True)


def tables(p):
    con = _ro(p)
    ts = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    con.close()
    return ts


def idx_map(p):
    con = _ro(p)
    rows = list(con.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='index'"
        " AND tbl_name=?", (DSO,)))
    con.close()
    return {n: s for n, s in rows}


def src_sig(p):
    if not os.path.exists(p):
        return None
    st = os.stat(p)
    return (round(st.st_mtime, 6), st.st_size)


SRC_BEFORE = src_sig(SRC)
print("=== A) 迁移幂等 + 部分唯一索引 ===")
print(f"源 fixture: 表数={len(tables(SRC))}  DSO存在={DSO in tables(SRC)}  sig={SRC_BEFORE}")

# 注意：本机 shim 拦截 os.remove（转回收站会失败）→ 一律用 copy2 覆盖，绝不 remove
shutil.copy2(SRC, COPY)
T0 = tables(COPY)
print(f"副本(迁移前): 表数={len(T0)}  DSO存在={DSO in T0}")

# --- rebind database engine to the COPY, then import migration module ---
from sqlalchemy import create_engine, inspect, text as sa_text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
import database  # noqa: E402

url = "sqlite:///" + COPY.replace("\\", "/")
database.DATABASE_URL = url
database.engine = create_engine(url, connect_args={"check_same_thread": False})
database.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=database.engine)

import migrate_asset_schema as mig  # noqa: E402

migrate_funcs = (mig.migrate_devices, mig.migrate_import_batches,
                 mig.create_new_tables, mig.migrate_device_serial_observations)

# --- run 1 ---
err1 = None
try:
    for f in migrate_funcs:
        f()
except Exception as e:  # noqa: BLE001
    err1 = repr(e)
t1, i1 = tables(COPY), idx_map(COPY)
print(f"run1: 异常={err1}  表数={len(t1)}  DSO存在={DSO in t1}")
print(f"run1: 索引={sorted(i1)}")

# --- run 2 (idempotence) ---
err2 = None
try:
    for f in migrate_funcs:
        f()
except Exception as e:  # noqa: BLE001
    err2 = repr(e)
t2, i2 = tables(COPY), idx_map(COPY)

print(f"run2: 异常={err2}  表集不变={t1 == t2}  索引不变={i1 == i2}")

# --- assertions ---
ok = True
def chk(name, cond, extra=""):
    global ok
    if not cond:
        ok = False
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {extra}")

chk("源 fixture 恒为 19 表且无 DSO",
    len(tables(SRC)) == 19 and DSO not in tables(SRC))
chk("迁移前副本 19 表且无 DSO（从零建表前提）",
    len(T0) == 19 and DSO not in T0, f"表数={len(T0)}")
chk("run1 无异常", err1 is None, f"err={err1}")
chk("run1 后 DSO 表已建", DSO in t1, f"表数={len(t1)}")
chk("run1 后共 20 表（19+1）", len(t1) == 20, f"={len(t1)}")
need = {"ux_dso_device_serial", "ix_dso_serial_norm", "ix_dso_device"}
chk("三索引齐备", need <= set(i1), f"缺={sorted(need - set(i1))}")
chk("run2 无异常（幂等）", err2 is None, f"err={err2}")
chk("run2 后表集合不变", t1 == t2)
chk("run2 后索引集合不变", i1 == i2)

ddl = (i1.get("ux_dso_device_serial") or "")
print(f"  ux_dso_device_serial DDL = {ddl}")
chk("部分唯一索引 DDL 含 WHERE status='active'",
    "UNIQUE INDEX" in ddl.upper() and "WHERE" in ddl.upper() and "active" in ddl)

# --- IntegrityError：重复 active 行被拦截，且事务回滚不留痕 ---
raised = False
try:
    with database.engine.begin() as conn:
        conn.execute(sa_text(
            "INSERT INTO device_serial_observations"
            "(device_code, serial_raw, serial_norm, status)"
            " VALUES ('__QA_IDX__', 'Z-9', 'Z9', 'active')"))
        conn.execute(sa_text(
            "INSERT INTO device_serial_observations"
            "(device_code, serial_raw, serial_norm, status)"
            " VALUES ('__QA_IDX__', 'Z-9', 'Z9', 'active')"))
except IntegrityError:
    raised = True
chk("重复 active (device,serial_norm) 触发 IntegrityError", raised)
with database.engine.begin() as conn:
    left = conn.execute(sa_text(
        "SELECT COUNT(*) FROM device_serial_observations"
        " WHERE device_code='__QA_IDX__'")).scalar()
chk("IntegrityError 后事务回滚（0 残留）", left == 0, f"left={left}")

# --- partial 语义：非 active 不受唯一约束 ---
def try_insert(pairs):
    try:
        with database.engine.begin() as conn:
            for dev, norm, st in pairs:
                conn.execute(sa_text(
                    "INSERT INTO device_serial_observations"
                    "(device_code, serial_raw, serial_norm, status)"
                    " VALUES (:d, :r, :n, :s)"),
                    {"d": dev, "r": norm, "n": norm, "s": st})
        return True
    except IntegrityError:
        return False


chk("active + rejected 同对并存允许", try_insert(
    [("__QA_M__", "Q1", "active"), ("__QA_M__", "Q1", "rejected")]))
chk("rejected + rejected 同对并存允许", try_insert(
    [("__QA_R__", "R1", "rejected"), ("__QA_R__", "R1", "rejected")]))
chk("quarantined + quarantined 同对并存允许", try_insert(
    [("__QA_Q__", "S1", "quarantined"), ("__QA_Q__", "S1", "quarantined")]))
chk("quarantined + active 同对并存允许（补录重放路径）", try_insert(
    [("__QA_QA__", "T1", "quarantined"), ("__QA_QA__", "T1", "active")]))

# --- 源 fixture 只读性 ---
SRC_AFTER = src_sig(SRC)
chk("源 fixture mtime/size 未被改动", SRC_BEFORE == SRC_AFTER,
    f"{SRC_BEFORE} -> {SRC_AFTER}")

print()
print(f"===== A) 结论: {'ALL PASS' if ok else 'HAS FAIL'} =====")
sys.exit(0 if ok else 1)
