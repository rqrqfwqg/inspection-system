# -*- coding: utf-8 -*-
"""QA 独立验证 · item 7(排序/确定性) / item 8(列表接口零回归 + 索引不污染 rows)"""
import copy
import json
import os
import subprocess
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402
import asset_ledger_routes as alr  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

print("=" * 70)
print("item 7 · 排序与确定性")
print("=" * 70)

INPUTS = ["G-1D9APt", "0512001", "BQL-B1-SB-01", "GE-2F-KTJF-101", "J-1",
          "105000620952", "152100424110742M", "配电箱"]
print("(1) 同一输入连续 20 次，候选序列是否逐次一致：")
all_stable = True
for q in INPUTS:
    sigs = []
    for _ in range(20):
        r = acm.resolve_code(idx, q)
        sigs.append(tuple((c["device_code"], c["match_type"], c["confidence"],
                           c["source_demoted"]) for c in r["candidates"]))
    stable = len(set(sigs)) == 1
    all_stable &= stable
    print(f"    {q!r:<22} 20次签名唯一={stable} 候选数={len(sigs[0])}")
print(f"  → 全部稳定: {'PASS' if all_stable else 'FAIL'}")

# (2) 合成同分 tie-break：devices 优先 → 短码优先
print("(2) 合成同分 tie-break（devices 优先 → device_code 短者优先）：")
syn_rows = [
    {"device_code": "ZZ-1", "source": "devices", "brand_model": "", "asset_code": "", "serial_no": "", "name": "N", "location": "", "area": ""},
    {"device_code": "ZZ1", "source": "ledger_only", "brand_model": "", "asset_code": "", "serial_no": "", "name": "N", "location": "", "area": ""},
    {"device_code": "AB", "source": "devices", "brand_model": "", "asset_code": "", "serial_no": "", "name": "N", "location": "", "area": ""},
    {"device_code": "AB-", "source": "devices", "brand_model": "", "asset_code": "", "serial_no": "", "name": "N", "location": "", "area": ""},
]
sidx = acm.build_match_index(None, syn_rows)
for q in ("ZZ1", "AB"):
    r = acm.resolve_code(sidx, q)
    print(f"    q={q!r} -> " + " | ".join(
        f"{c['device_code']}(conf={c['confidence']},src={c['source']},len={len(c['device_code'])})"
        for c in r["candidates"]))

print("\n" + "=" * 70)
print("item 8 · 列表接口零回归 + 索引不污染 rows")
print("=" * 70)

# (A) 非污染：build_match_index 是否就地修改 rows
rows0 = Q.fresh_rows_noindex(db)
snap = copy.deepcopy(rows0)
acm.build_match_index(db, rows0)
print(f"(A) build_match_index 后 rows 与快照相等: {rows0 == snap}  "
      f"{'PASS(未污染)' if rows0 == snap else 'FAIL(被污染)'}")
if rows0 != snap:
    # 找差异
    for a, b in zip(snap, rows0):
        if a != b:
            diffk = {k for k in set(a) | set(b) if a.get(k) != b.get(k)}
            print("    首个差异行:", a.get("device_code"), "字段:", diffk)
            break

# (B) 端点响应 before/after 逐字节一致（before = 索引构建为 no-op）
COMBOS = [
    dict(),
    dict(source="ledger_only"),
    dict(state="with_asset"),
    dict(q="配电箱"),
    dict(sort="price_tax", order="desc"),
    dict(sort="name", order="asc", page=2, page_size=50),
    dict(area="GTC", state="bim", sort="record_count", order="desc"),
]


def call_endpoint(**kw):
    return alr.list_asset_ledger(db=db, _=None, **kw)


def dump(resp):
    return json.dumps(resp, ensure_ascii=False, sort_keys=True, default=str)


# BEFORE：noop 索引
alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
_orig = alr.build_match_index
alr.build_match_index = lambda d, rws: {"_noop": True}
try:
    before = []
    for c in COMBOS:
        alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
        before.append(dump(call_endpoint(**c)))
finally:
    alr.build_match_index = _orig

# AFTER：真实索引
after = []
for c in COMBOS:
    alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
    alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
    after.append(dump(call_endpoint(**c)))

print(f"(B) 列表接口 before/after 逐字节一致：")
same = 0
for c, b, a in zip(COMBOS, before, after):
    eq = (b == a)
    same += eq
    print(f"    {str(c):<70} {'一致' if eq else '不一致'}")
print(f"  → 一致 {same}/{len(COMBOS)}  {'PASS' if same == len(COMBOS) else 'FAIL'}")

# (C) 端点响应字段集合（是否被意外增删）
resp0 = call_endpoint()
print(f"(C) 列表接口顶层字段: {sorted(resp0.keys())}（期望 total/page/page_size/pages/items/facets）")
item0 = resp0["items"][0]
print(f"    item 字段数={len(item0)} 字段: {sorted(item0.keys())}")

print("\n[完成 sort_regress]")
