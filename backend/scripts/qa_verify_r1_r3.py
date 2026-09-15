# -*- coding: utf-8 -*-
"""QA 独立验证 · item 3(R1 穷举封顶) / item 5(R3 边界)"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

print("=" * 70)
print("item 3 · R1：ledger_only 精确层不得越级（穷举）")
print("=" * 70)

# (1) 合成：对每个 EXACT_TYPE，ledger_only 均须被封顶
print("(1) 合成穷举 —— 每个精确类型 × source")
bad = 0
for mt in sorted(acm.EXACT_TYPES):
    for src in ("ledger_only", "devices"):
        h = {"device_code": "X", "source": src, "match_type": mt,
             "confidence": acm.MATCH_PRIORITY[mt], "source_demoted": False}
        orig = acm.MATCH_PRIORITY[mt]
        acm._apply_source_demotion([h])
        if src == "ledger_only":
            # R1 判据：任何精确层命中，ledger_only 的 confidence 必须 ≤88；
            # 仅当原值 >88 时才封顶并置 demoted。
            ok = h["confidence"] <= 88 and (
                (orig > 88 and h["confidence"] == 88 and h["source_demoted"] is True)
                or (orig <= 88 and h["confidence"] == orig and h["source_demoted"] is False))
        else:
            ok = h["confidence"] == orig and h["source_demoted"] is False
        if not ok:
            bad += 1
        print(f"    {mt:<20} source={src:<12} conf={h['confidence']:<4} "
              f"demoted={h['source_demoted']}  {'OK' if ok else 'VIOLATION'}")
print(f"  → 违反数 = {bad}  {'PASS' if bad == 0 else 'FAIL'}")

# 专项：observation_exact(96) 指向 ledger_only
h = {"device_code": "OBS", "source": "ledger_only", "match_type": "observation_exact",
     "confidence": 96, "source_demoted": False}
acm._apply_source_demotion([h])
print(f"(2) observation_exact(96) ledger_only → conf={h['confidence']} demoted={h['source_demoted']}"
      f"  {'PASS' if h['confidence']<=88 and h['source_demoted'] else 'FAIL'}")
# 已登记 device_code_exact 不误伤
h = {"device_code": "REG", "source": "devices", "match_type": "device_code_exact",
     "confidence": 100, "source_demoted": False}
acm._apply_source_demotion([h])
print(f"(3) device_code_exact(100) devices → conf={h['confidence']} demoted={h['source_demoted']}"
      f"  {'PASS' if h['confidence']==100 and not h['source_demoted'] else 'FAIL'}")

# (4) 数据驱动：所有 ledger_only 行，其各精确空间命中的 confidence 必须 ≤88
lo_rows = [r for r in rows if r.get("source") == "ledger_only"]
print(f"(4) 数据驱动 —— ledger_only 行数 = {len(lo_rows)}")
viol = 0
checked = 0
for r in lo_rows:
    for mt, mv in (("device_code_exact", r.get("device_code")),
                   ("serial_no_exact", r.get("serial_no")),
                   ("brand_extract_exact", acm.extract_serial_from_brand(r.get("brand_model")))):
        if not mv:
            continue
        hits = [acm._hit(r, mt, mt, mv)]
        acm._apply_source_demotion(hits)
        checked += 1
        if hits[0]["confidence"] > 88 or not hits[0]["source_demoted"]:
            viol += 1
            if viol <= 5:
                print(f"    VIOLATION {r['device_code']} {mt} conf={hits[0]['confidence']}")
print(f"    检查 {checked} 个 (行×精确空间)，越级 = {viol}  {'PASS' if viol==0 else 'FAIL'}")

# (5) 已登记设备 device_code 仍 100（抽样全量）
viol2 = 0
n_dev = 0
for r in rows:
    if r.get("source") != "devices":
        continue
    code = r.get("device_code")
    if not code:
        continue
    res = acm.resolve_code(idx, code, limit=20)
    tgt = [c for c in res["candidates"] if c["device_code"] == code]
    n_dev += 1
    if tgt and tgt[0]["match_type"] == "device_code_exact" and tgt[0]["confidence"] != 100:
        viol2 += 1
    if tgt and tgt[0]["source_demoted"]:
        viol2 += 1
print(f"(5) 已登记设备 device_code_exact 仍 100：检查 {n_dev} 台，违反 = {viol2}"
      f"  {'PASS' if viol2==0 else 'FAIL'}")

# (6) 基准：q=G-1D9APt
r = acm.resolve_code(idx, "G-1D9APt")
top = r["candidates"][0]
sec = r["candidates"][1] if len(r["candidates"]) > 1 else {}
print(f"(6) 基准 q=G-1D9APt: count={r['count']}（期望2）")
print(f"    top={top['device_code']} {top['match_type']} {top['confidence']} {top['source']} demoted={top['source_demoted']}")
print(f"    2nd={sec.get('device_code')} {sec.get('match_type')} {sec.get('confidence')} {sec.get('source')} demoted={sec.get('source_demoted')}")
ok = (r["count"] == 2 and top["device_code"] == "105000620952" and top["match_type"] == "brand_extract_exact"
      and top["confidence"] == 92 and sec.get("device_code") == "G-1D9APt"
      and sec.get("confidence") == 88 and sec.get("source_demoted") is True)
print(f"    {'PASS' if ok else 'FAIL'}")

print("\n" + "=" * 70)
print("item 5 · R3：device_code 不判歧义 + 不误伤唯一位")
print("=" * 70)

# (1) 7 个 loose 不得在 shared_values
seven = ["GE2FKTJF101", "GE2FKTJF205", "GW2FKTJF101", "GW2FKTJF205",
         "P11N2FKTJF102", "J1", "J4"]
present = [v for v in seven if v in idx["shared_values"]]
print(f"(1) 7 个 device_code 撞车 loose 是否在 shared_values: 命中 {present}  "
      f"{'PASS' if not present else 'FAIL'}")
print(f"    SHARED_VALUE_FIELDS = {acm.SHARED_VALUE_FIELDS}  "
      f"{'PASS(无device_code)' if 'device_code' not in acm.SHARED_VALUE_FIELDS else 'FAIL'}")

# (2) q=J-1 不歧义
r = acm.resolve_code(idx, "J-1")
print(f"(2) q=J-1: kind={r['kind']} exact={r['exact']} count={r['count']} shared_count={r.get('shared_count')}")
for c in r["candidates"]:
    print(f"      {c['device_code']:<8} {c['match_type']:<20} conf={c['confidence']} "
          f"source={c['source']} demoted={c['source_demoted']}")
ok = r["kind"] != "ambiguous" and r["exact"] is True
print(f"    → 非歧义且 exact: {'PASS' if ok else 'FAIL'}")

# (3) 唯一序列号
r = acm.resolve_code(idx, "152100424110742M")
print(f"(3) q=152100424110742M: kind={r['kind']} exact={r['exact']} shared_count={r.get('shared_count')} "
      f"count={r['count']}")
if r["candidates"]:
    c = r["candidates"][0]
    print(f"      top={c['device_code']} {c['match_type']} {c['confidence']} mv={c['matched_value']!r}")
ok = r.get("shared_count", 1) == 1 and r["kind"] != "ambiguous"
print(f"    → shared_count=1 且非歧义: {'PASS' if ok else 'FAIL'}")

# (4) 全局唯一 BIM tag → 仍精确命中
for bim in ("10430201211100004970",):
    r = acm.resolve_code(idx, bim)
    print(f"(4) q={bim}: kind={r['kind']} exact={r['exact']} shared_count={r.get('shared_count')} count={r['count']}")
    for c in r["candidates"][:3]:
        print(f"      {c['device_code']:<16} {c['match_type']:<20} conf={c['confidence']} mv={c['matched_value']!r}")

print("\n[完成 r1_r3]")
