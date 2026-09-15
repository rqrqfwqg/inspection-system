# -*- coding: utf-8 -*-
"""QA v4 · T3：R4 过度杀伤 —— 全量 device_code 扫描 + 已登记设备落入 shared_values + 新歧义键抽查"""
import os
import random
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)
sh = idx["shared_values"]
FIELDS = acm.SHARED_VALUE_FIELDS


def loose4(r):
    s = set()
    for f in FIELDS:
        lv = acm.normalize_code(r.get(f))["loose"]
        if lv:
            s.add(lv)
    ex = acm.normalize_code(acm.extract_serial_from_brand(r.get("brand_model")))["loose"]
    if ex:
        s.add(ex)
    return s


def loose3(r):
    s = set()
    for f in FIELDS:
        lv = acm.normalize_code(r.get(f))["loose"]
        if lv:
            s.add(lv)
    return s


# v3 三字段 / v4 四来源 共用键集合
t3, t4 = {}, {}
for r in rows:
    for lv in loose3(r):
        t3[lv] = t3.get(lv, 0) + 1
    for lv in loose4(r):
        t4[lv] = t4.get(lv, 0) + 1
S3 = {k for k, v in t3.items() if v >= 2}
S4 = {k for k, v in t4.items() if v >= 2}
new = sorted(S4 - S3)
print(f"v3共用键={len(S3)}  v4共用键={len(S4)}  R4新增歧义键={len(new)}")

# ---- (A) 全量 device_code 扫描 ----
print("\n=== (A) 对全部 8977 个 device_code 逐个 resolve，统计 kind='ambiguous' ===")
amb = []
for r in rows:
    code = r.get("device_code")
    if not code:
        continue
    res = acm.resolve_code(idx, code)
    if res["kind"] == "ambiguous":
        amb.append((code, r.get("source"), res.get("shared_count")))
print(f"返回 ambiguous 的 device_code 数 = {len(amb)} / {len(rows)}")
for code, src, sc in amb[:40]:
    print(f"    {code!r:<28} source={src:<12} shared_count={sc}")

# ---- (B) 已登记(devices)设备的 device_code 落入 shared_values ----
print("\n=== (B) 已登记设备 device_code 的 loose 落入 shared_values ===")
dev_in_shared = []
for r in rows:
    if r.get("source") != "devices":
        continue
    lv = acm.normalize_code(r.get("device_code"))["loose"]
    if lv and lv in sh:
        dev_in_shared.append((r.get("device_code"), lv, sh[lv]))
print(f"数量 = {len(dev_in_shared)}")
for code, lv, n in dev_in_shared[:40]:
    print(f"    {code!r:<28} loose={lv!r:<20} shared={n}")

# ---- (C) 抽查 20 个 R4 新增歧义键，核实确被 >=2 台共用（原始行举证） ----
print("\n=== (C) 抽查 20 个 R4 新增歧义键（原值举证） ===")
rnd = random.Random(20260913)
sample = rnd.sample(new, min(20, len(new)))
for k in sample:
    hit_rows = []
    for r in rows:
        if k in loose4(r):
            hit_rows.append(r)
    codes = {r.get("device_code") for r in hit_rows}
    ex_rows = [r for r in hit_rows
               if acm.normalize_code(acm.extract_serial_from_brand(r.get("brand_model")))["loose"] == k]
    print(f"\n  key={k!r}  命中行={len(hit_rows)} 去重设备={len(codes)}  抽取来源行={len(ex_rows)}")
    for r in ex_rows[:3]:
        print(f"      {r.get('device_code')} source={r.get('source')} brand_model={r.get('brand_model')!r}")
    for r in hit_rows[:3]:
        if r not in ex_rows:
            print(f"      [整串命中] {r.get('device_code')} brand_model={r.get('brand_model')!r} "
                  f"asset_code={r.get('asset_code')!r} serial_no={r.get('serial_no')!r}")
