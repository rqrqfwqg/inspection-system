# -*- coding: utf-8 -*-
"""QA v4 · T5：回归（硬不变量 / rows 不污染 / 列表 7/7 / 确定性 / 无注入）"""
import copy
import json
import os
import re
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402
import asset_ledger_routes as alr  # noqa: E402

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

print("=== T5-1 硬不变量（全表）===")
cjk_bad, n1 = [], 0
for key, entries in idx["brand_serial"].items():
    for e in entries:
        n1 += 1
        mv = e[1] if (isinstance(e, tuple) and len(e) == 3 and e[2] == "observation") else e[1]
        if CJK.search(str(mv)):
            cjk_bad.append((key, mv))
print(f"  不变量A(brand_serial matched_value 含CJK): {len(cjk_bad)} / {n1}  "
      f"{'PASS' if not cjk_bad else 'FAIL'}")
viol, n2 = [], 0
for key, entries in idx["brand_serial"].items():
    for e in entries:
        if isinstance(e, tuple) and len(e) == 3 and e[2] == "observation":
            continue
        r, bm = e
        n2 += 1
        if acm.normalize_code(r.get("serial_no"))["loose"] and \
           acm.normalize_code(bm)["loose"] == acm.normalize_code(r.get("serial_no"))["loose"]:
            viol.append((r.get("device_code"), bm, r.get("serial_no")))
print(f"  不变量B(机身编号 matched_value == 同设备 serial_no): {len(viol)} / {n2}  "
      f"{'PASS' if not viol else 'FAIL'}")

print("\n=== T5-2 build_match_index 是否污染 rows ===")
rows0 = Q.fresh_rows_noindex(db)
snap = copy.deepcopy(rows0)
acm.build_match_index(db, rows0)
print(f"  rows == deepcopy(快照): {rows0 == snap}  {'PASS(未污染)' if rows0 == snap else 'FAIL'}")

print("\n=== T5-3 列表接口 before/after 逐字节 ===")
COMBOS = [dict(), dict(source="ledger_only"), dict(state="with_asset"), dict(q="配电箱"),
          dict(sort="price_tax", order="desc"),
          dict(sort="name", order="asc", page=2, page_size=50),
          dict(area="GTC", state="bim", sort="record_count", order="desc")]


def dump(r):
    return json.dumps(r, ensure_ascii=False, sort_keys=True, default=str)


alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
_orig = alr.build_match_index
alr.build_match_index = lambda d, rws: {"_noop": True}
try:
    before = []
    for c in COMBOS:
        alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
        before.append(dump(alr.list_asset_ledger(db=db, _=None, **c)))
finally:
    alr.build_match_index = _orig
after = []
for c in COMBOS:
    alr._ALL_CACHE.update({"key": None, "ts": 0.0, "rows": []})
    alr._MATCH_INDEX.update({"key": None, "ts": 0.0, "idx": None})
    after.append(dump(alr.list_asset_ledger(db=db, _=None, **c)))
same = sum(1 for a, b in zip(before, after) if a == b)
print(f"  一致 {same}/{len(COMBOS)}  {'PASS' if same == len(COMBOS) else 'FAIL'}")

print("\n=== T5-4 排序确定性（连续 20 次）===")
INPUTS = ["G-1D9APt", "0512001", "BQL-B1-SB-01", "GE-2F-KTJF-101", "J-1",
          "105000620952", "152100424110742M", "配电箱", "595036PME"]
stable = True
for q in INPUTS:
    sigs = set()
    for _ in range(20):
        r = acm.resolve_code(idx, q)
        sigs.add(tuple((c["device_code"], c["match_type"], c["confidence"], c["source_demoted"])
                       for c in r["candidates"]))
    stable &= (len(sigs) == 1)
    print(f"  {q!r:<22} 20次签名唯一={len(sigs)==1}")
print(f"  → {'PASS' if stable else 'FAIL'}")

print("\n=== T5-5 无 LIKE / SQL 注入（内核源码 + 实测）===")
src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "asset_code_match.py"), encoding="utf-8").read()
has_like = bool(re.search(r"\bLIKE\b|\bGLOB\b", src, re.I))
print(f"  源码含 LIKE/GLOB: {has_like}")
for q in ["%", "_", "%%", "'; DROP TABLE devices;--", "1 OR 1=1", "%_%"]:
    r = acm.resolve_code(idx, q)
    print(f"  q={q!r:<26} kind={r['kind']} count={r['count']}")

# 供跨进程比对
SIG = {q: [[c["device_code"], c["match_type"], c["confidence"]] for c in acm.resolve_code(idx, q)["candidates"]]
       for q in INPUTS}
print("\nSIG=" + json.dumps({"sig": SIG, "shared": sorted(idx["shared_values"].items())[::53]},
                            ensure_ascii=False, sort_keys=True))
