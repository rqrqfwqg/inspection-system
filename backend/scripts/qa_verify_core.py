# -*- coding: utf-8 -*-
"""QA 独立验证 · 核心：item 4(R2)/5(R3)/6(硬不变量)/9(M1-M9 复算)

全部基于 fixture 与内核只读调用。原始输出直接打印。
"""
import os
import re
import sqlite3
import sys
import unicodedata

import qa_common as Q

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

import asset_code_match as acm  # noqa: E402

FIX = Q.FIX
CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def loose(s):
    return acm.normalize_code(s)["loose"]


print("=" * 70)
print("QA 核心验证 · fixture =", FIX)
print("=" * 70)

# ---------- 装配 ----------
db = Q.get_session()
rows = Q.load_rows(db)
print(f"[装配] _load_all 行数 = {len(rows)}  (期望 8977)  {'PASS' if len(rows)==8977 else 'FAIL'}")
idx = acm.build_match_index(db, rows)
print(f"[装配] by_code={len(idx['by_code'])} device_code空间键={len(idx['device_code'])} "
      f"serial_no空间键={len(idx['serial_no'])} brand_serial空间键={len(idx['brand_serial'])} "
      f"alias空间键={len(idx['alias'])} shared_keys={len(idx['shared_values'])}")

con = sqlite3.connect(FIX)

# ============================================================
# item 9 · M1-M9 复算
# ============================================================
print("\n" + "-" * 70)
print("item 9 · M1-M9 独立复算")
print("-" * 70)

# --- M1: 孤儿 device_code 中 len>=4 且作为已登记设备 brand_model 子串者 = 489 ---
dev_codes = {r[0] for r in con.execute("SELECT device_code FROM devices WHERE device_code<>''")}
fa_codes = {r[0] for r in con.execute("SELECT device_code FROM fixed_assets WHERE device_code<>''")}
rec_codes = [r[0] for r in con.execute("SELECT DISTINCT device_code FROM records WHERE device_code<>''")]
orphans = [c for c in rec_codes if c not in dev_codes and c not in fa_codes and len(c) >= 4]
bms = [str(r[0]) for r in con.execute(
    "SELECT f.brand_model FROM fixed_assets f JOIN devices d ON d.device_code=f.device_code"
    " WHERE f.brand_model IS NOT NULL AND f.brand_model<>''")]
blob = "\x00".join(bms)  # 哨兵分隔：code 不含 \x00，故不会跨边界误命中
m1_hits = [c for c in orphans if c in blob]
print(f"M1: 孤儿(len>=4)={len(orphans)}  其中作为已登记设备 brand_model 子串={len(m1_hits)}"
      f"  （设计=489）  {'一致' if len(m1_hits)==489 else '不一致'}")

# --- helper：按设计口径（三字段 / loose / 合并行 / 行内去重）统计 shared ---
SHARED_FIELDS = acm.SHARED_VALUE_FIELDS
print(f"    SHARED_VALUE_FIELDS = {SHARED_FIELDS}  （R3：应无 device_code）")

# 用生产 rows 重算（与内核同源，但独立实现）
def recompute_shared(rows):
    per_field = {f: {} for f in SHARED_FIELDS}
    total = {}
    for r in rows:
        seen = set()
        for f in SHARED_FIELDS:
            lv = loose(r.get(f))
            if lv:
                per_field[f][lv] = per_field[f].get(lv, 0) + 1
                seen.add(lv)
        for lv in seen:
            total[lv] = total.get(lv, 0) + 1
    return per_field, total


per_field, total = recompute_shared(rows)
shared_set = {k for k, v in total.items() if v >= 2}
print(f"M2: shared_values 集合大小={len(shared_set)}（设计 447）  总键={len(total)}（设计 3796）"
      f"  {'一致' if len(shared_set)==447 and len(total)==3796 else '不一致'}")
# 与内核实测比对
kern_shared = idx["shared_values"]
diff = {k for k in set(kern_shared) | set(total) if kern_shared.get(k, 0) != total.get(k, 0)}
print(f"    与内核 shared_values 逐键比对：键数内核={len(kern_shared)} 我={len(total)} 不一致键={len(diff)}"
      f"  {'一致' if not diff else '不一致'}")
for k in list(diff)[:10]:
    print(f"      diff {k!r}: 内核={kern_shared.get(k)} 我={total.get(k)}")

sf_counts = {f: len([k for k, v in per_field[f].items() if v >= 2]) for f in SHARED_FIELDS}
# device_code 单字段（用于对照 M2a，R3 剔除但仍可算）
dc = {}
for r in rows:
    lv = loose(r.get("device_code"))
    if lv:
        dc[lv] = dc.get(lv, 0) + 1
dc_shared = len([k for k, v in dc.items() if v >= 2])
print(f"M2a: 单字段共用键数 device_code={dc_shared}(设计7) asset_code={sf_counts['asset_code']}(设计109) "
      f"serial_no={sf_counts['serial_no']}(设计113) brand_model={sf_counts['brand_model']}(设计243)"
      f"  {'一致' if (dc_shared,sf_counts['asset_code'],sf_counts['serial_no'],sf_counts['brand_model'])==(7,109,113,243) else '不一致'}")

# --- M3: q=0512001 ---
l0512 = "0512001"
bm_single = per_field["brand_model"].get(l0512, 0)
ac_single = per_field["asset_code"].get(l0512, 0)
print(f"M3: 0512001 brand_model单字段={bm_single}(设计401) asset_code单字段={ac_single} "
      f"shared_count(并集)={total.get(l0512)}(设计447)  内核={kern_shared.get(l0512)}")

r0512 = acm.resolve_code(idx, "0512001")
print(f"    内核 resolve(q=0512001): kind={r0512['kind']} exact={r0512['exact']} "
      f"shared_count={r0512.get('shared_count')} count={r0512['count']} "
      f"hint.can_observe={(r0512.get('hint') or {}).get('can_observe')}")

# --- M4: asset_code='BQL-B1-SB-01' 3 台 ---
m4 = [r[0] for r in con.execute(
    "SELECT device_code FROM fixed_assets WHERE asset_code='BQL-B1-SB-01'")]
m4 += [r[0] for r in con.execute(
    "SELECT device_code FROM devices WHERE asset_code='BQL-B1-SB-01'")]
m4 = sorted(set(m4))
r_bql = acm.resolve_code(idx, "BQL-B1-SB-01")
print(f"M4: asset_code='BQL-B1-SB-01' -> {len(m4)} 台 {m4}（设计 3 台 105000625413/17/25）"
      f"  内核 shared_count={r_bql.get('shared_count')} kind={r_bql['kind']}")

# --- M5: q=G-1D9APt ---
r_g = acm.resolve_code(idx, "G-1D9APt")
print(f"M5: q=G-1D9APt count={r_g['count']} kind={r_g['kind']}")
for c in r_g["candidates"][:4]:
    print(f"      {c['device_code']:<16} {c['match_type']:<20} conf={c['confidence']} "
          f"source={c['source']} demoted={c['source_demoted']} mv={c['matched_value']!r}")

# --- M6: alias id=1402 ---
try:
    a = con.execute("SELECT id, canonical_code, alias_code FROM device_aliases WHERE id=1402").fetchone()
    print(f"M6: alias id=1402 -> {a}")
except Exception as e:
    print("M6 err", e)

# --- M7: serial_no 是型号串 ---
sn_raw = {}
for r in con.execute("SELECT serial_no FROM fixed_assets WHERE serial_no IS NOT NULL AND serial_no<>''"):
    v = re.sub(r"\s+", " ", str(r[0])).strip()
    sn_raw[v] = sn_raw.get(v, 0) + 1
top = sorted(sn_raw.items(), key=lambda x: -x[1])[:6]
print("M7: serial_no 最高频原值 Top6:")
for v, n in top:
    print(f"      {n:>5}  {v!r}")
sn_loose = {}
for r in con.execute("SELECT serial_no FROM fixed_assets WHERE serial_no IS NOT NULL AND serial_no<>''"):
    lv = loose(r[0])
    if lv:
        sn_loose[lv] = sn_loose.get(lv, 0) + 1
print(f"    serial_no 共用键(loose,>=2) = {len([1 for v in sn_loose.values() if v>=2])}（设计113）")

# --- M8: asset_code 7 位分类码污染 ---
for code in ("0306002", "0603001", "0402001"):
    n = con.execute("SELECT COUNT(*) FROM (SELECT device_code FROM fixed_assets WHERE asset_code=?"
                    " UNION SELECT device_code FROM devices WHERE asset_code=?)", (code, code)).fetchone()[0]
    print(f"M8: asset_code={code} -> {n} 台")

# --- M9: device_code 撞车 7 组 ---
dcg = {}
for c in dev_codes | fa_codes | set(rec_codes):
    lv = loose(c)
    dcg.setdefault(lv, set()).add(c)
coll = {k: sorted(v) for k, v in dcg.items() if len(v) >= 2}
print(f"M9: device_code loose 撞车组数 = {len(coll)}（设计 7）")
for k, v in sorted(coll.items()):
    print(f"      {k}: {v}")

print()
print("=" * 70)
print("item 6 · 硬不变量（全表，非抽样）")
print("=" * 70)

# (a) brand_serial 空间所有 matched_value 不得含 CJK
#     （brand_extract_exact / observation_exact 的 matched_value）
cjk_bad = []
n_brand = 0
for key, entries in idx["brand_serial"].items():
    for e in entries:
        if isinstance(e, tuple) and len(e) == 3 and e[2] == "observation":
            mv = e[1]
            n_brand += 1
        else:
            r, bm = e
            mv = bm
            n_brand += 1
        if CJK.search(str(mv)):
            cjk_bad.append((key, mv))
print(f"Invariant-A: brand_serial 候选 matched_value 含 CJK 的条数 = {len(cjk_bad)} "
      f"(总 {n_brand})  {'PASS' if not cjk_bad else 'FAIL'}")
for k, mv in cjk_bad[:10]:
    print(f"      {k!r} -> {mv!r}")

# (b) 机身编号候选 matched_value != 该设备的 serial_no
viol = []
n_checked = 0
for key, entries in idx["brand_serial"].items():
    for e in entries:
        if isinstance(e, tuple) and len(e) == 3 and e[2] == "observation":
            continue
        r, bm = e
        n_checked += 1
        rsn = loose(r.get("serial_no"))
        if rsn and loose(bm) == rsn:
            viol.append((r.get("device_code"), bm, r.get("serial_no")))
print(f"Invariant-B: brand_extract 候选 matched_value 等于同设备 serial_no 的条数 = {len(viol)} "
      f"(检查 {n_checked})  {'PASS' if not viol else 'FAIL'}")
for v in viol[:10]:
    print(f"      {v}")

con.close()
print("\n[完成 core]")
