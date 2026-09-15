# -*- coding: utf-8 -*-
"""QA 独立验证 · 深挖 M1(488 vs 489) 与 M9(组形状) 的差异来源。"""
import os
import re
import sqlite3
import sys

import qa_common as Q
import asset_code_match as acm

FIX = Q.FIX
con = sqlite3.connect(FIX)

dev_codes = {r[0] for r in con.execute("SELECT device_code FROM devices WHERE device_code<>''")}
fa_codes = {r[0] for r in con.execute("SELECT device_code FROM fixed_assets WHERE device_code<>''")}
rec_codes = [r[0] for r in con.execute("SELECT DISTINCT device_code FROM records WHERE device_code<>''")]

# ---- M1 变体 ----
bms_reg = [str(r[0]) for r in con.execute(
    "SELECT f.brand_model FROM fixed_assets f JOIN devices d ON d.device_code=f.device_code"
    " WHERE f.brand_model IS NOT NULL AND f.brand_model<>''")]
blob = "\x00".join(bms_reg)
blob_lo = "\x00".join(acm.normalize_code(x)["loose"] for x in bms_reg)

def orphan_set(excl_fa):
    s = set()
    for c in rec_codes:
        if c in dev_codes:
            continue
        if excl_fa and c in fa_codes:
            continue
        s.add(c)
    return s

print("== M1 变体 ==")
for excl_fa in (True, False):
    for minlen in (4,):
        o = [c for c in orphan_set(excl_fa) if len(c) >= minlen]
        hit_cs = [c for c in o if c in blob]                      # 区分大小写
        hit_ci = [c for c in o if c.lower() in blob.lower()]      # 不区分大小写
        hit_lo = [c for c in o if acm.normalize_code(c)["loose"] in blob_lo]
        print(f"  excl_fa={excl_fa} len>={minlen}: orphans={len(o)}  cs={len(hit_cs)} ci={len(hit_ci)} loose={len(hit_lo)}")
# 全 records 行（含重复）计数
print("  records 行级(非 distinct) 孤儿口径计数（excl_fa=True, len>=4, cs）:",
      sum(1 for r in con.execute("SELECT device_code FROM records WHERE device_code<>''")
          if r[0] not in dev_codes and r[0] not in fa_codes and len(r[0]) >= 4
          and r[0] in blob))

# 找出两种口径差的那一条（cs 与 ci 的差集）
o = [c for c in orphan_set(True) if len(c) >= 4]
cs = set(c for c in o if c in blob)
ci = set(c for c in o if c.lower() in blob.lower())
print("  cs⊂ci 差（仅大小写不同而命中）:", sorted(ci - cs)[:20])

# ---- M9 ----
print("\n== M9 device_code 撞车明细 ==")
dcg = {}
for c in dev_codes | fa_codes | set(rec_codes):
    dcg.setdefault(acm.normalize_code(c)["loose"], set()).add(c)
coll = {k: sorted(v) for k, v in dcg.items() if len(v) >= 2}
print(f"组数={len(coll)}")
for k, v in sorted(coll.items()):
    print(f"  {k}: {v}")
# 单独查这几个 raw 是否存在
for probe in ("GE2FKTJF101", "GE2FKTJF205", "GW2FKTJF101", "GW2FKTJF205",
              "P11N2FKTJF102", "J1", "J4", "GE2F-KTJF-101", "GE-2F-KTJF-101"):
    where = []
    if probe in dev_codes:
        where.append("devices")
    if probe in fa_codes:
        where.append("fixed_assets")
    if probe in set(rec_codes):
        where.append("records")
    print(f"  raw {probe!r} 存在于: {where or '无'}")

# ---- M3 附加：359 个不同 asset_code ----
bm_devs = [r[0] for r in con.execute(
    "SELECT DISTINCT device_code FROM fixed_assets WHERE brand_model LIKE '%0512001%'")]
acs = set()
for dc in bm_devs:
    row = con.execute("SELECT asset_code FROM fixed_assets WHERE device_code=?", (dc,)).fetchone()
    drow = con.execute("SELECT asset_code FROM devices WHERE device_code=?", (dc,)).fetchone()
    v = (row[0] if row and row[0] else "") or (drow[0] if drow and drow[0] else "")
    if v:
        acs.add(str(v).strip())
print(f"\n== M3 附加：brand_model 含 0512001 的设备 {len(bm_devs)} 台，其中不同 asset_code 数 = {len(acs)}（设计 359）")

# ---- M7 附加：'/' 与 西门子，XC720 ----
print("\n== M7 附加 ==")
print("  serial_no='/' 计数:", con.execute("SELECT COUNT(*) FROM fixed_assets WHERE serial_no='/'").fetchone()[0])
print("  serial_no='西门子，XC720' 计数:",
      con.execute("SELECT COUNT(*) FROM fixed_assets WHERE serial_no='西门子，XC720'").fetchone()[0])
print("  serial_no 非空行数:", con.execute("SELECT COUNT(*) FROM fixed_assets WHERE serial_no IS NOT NULL AND serial_no<>''").fetchone()[0])
print("  serial_no 非空且 loose 非空行数:",
      sum(1 for r in con.execute("SELECT serial_no FROM fixed_assets WHERE serial_no IS NOT NULL AND serial_no<>''")
          if acm.normalize_code(r[0])["loose"]))

con.close()
