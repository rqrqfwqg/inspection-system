# -*- coding: utf-8 -*-
"""QA final · E（R3' 往返 + 排序）+ F（R5/R6 副作用）+ G（T3 复核）"""
import json
import os
import sys
from collections import Counter

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)


def show(q):
    r = acm.resolve_code(idx, q)
    print(f"  q={q!r:<18} kind={r['kind']:<11} exact={r['exact']!s:<5} count={r['count']:<4} "
          f"shared_count={r.get('shared_count')} has_hint={('hint' in r)}")
    for i, c in enumerate(r["candidates"]):
        print(f"        [{i}] {c['device_code']:<16} {c['match_type']:<20} conf={c['confidence']:<4} "
              f"src={c['source']:<12} demoted={c['source_demoted']}")
    return r


print("=== E · R3' 往返 ===")
show("J-1")
show("J1")
show("G-1D5ATx1")
show("WP-2D7APk1")
show("105000620952")

print("\n=== E · J1 排序断言（已登记 100 分须在影子 88 分之前）===")
r = acm.resolve_code(idx, "J1")
pos = {c["device_code"]: i for i, c in enumerate(r["candidates"])}
reg = [c for c in r["candidates"] if c["source"] == "devices"]
shadow = [c for c in r["candidates"] if c["source"] == "ledger_only"]
print(f"  候选序 = {[c['device_code'] for c in r['candidates']]}")
print(f"  已登记候选 = {[(c['device_code'], c['confidence']) for c in reg]}")
print(f"  影子候选   = {[(c['device_code'], c['confidence'], c['source_demoted']) for c in shadow]}")
order_ok = all(pos[c["device_code"]] < pos[s["device_code"]] for c in reg for s in shadow)
print(f"  所有已登记候选都排在所有影子候选之前 ? {order_ok}  {'PASS' if order_ok else 'FAIL(反例)'}")

print("\n=== E · 全 8977 device_code：已登记设备误判 ambiguous 数 ===")
cnt = Counter()
amb = []
amb_dev = []
for r2 in rows:
    code = r2.get("device_code")
    if not code:
        continue
    res = acm.resolve_code(idx, code)
    cnt[res["kind"]] += 1
    if res["kind"] == "ambiguous":
        amb.append((code, r2.get("source"), res.get("shared_count")))
        if r2.get("source") == "devices":
            amb_dev.append(code)
total = sum(cnt.values())
print(f"  total={total}  分布: " + " / ".join(f"{k}={v}" for k, v in cnt.most_common()))
print(f"  ambiguous 清单 = {amb}")
print(f"  其中 source=='devices' 被误判 = {len(amb_dev)} {amb_dev}")

print("\n=== F · R5/R6 副作用 ===")
print(f"  _fuzzy_hits(idx,'ab') = {acm._fuzzy_hits(idx, 'ab')}（应为 []）")
print(f"  _fuzzy_hits(idx,'1')  = {acm._fuzzy_hits(idx, '1')}（应为 []）")
print(f"  _fuzzy_hits(idx,'ＧＥ１Ｆ') = len={len(acm._fuzzy_hits(idx, 'ＧＥ１Ｆ'))}（应>0）")
r = acm.resolve_code(idx, "ＧＥ１Ｆ")
print(f"  resolve('ＧＥ１Ｆ') kind={r['kind']} count={r['count']}（应>0）")
# loose<3 时 hint
for q in ["1", "J", "AB", "ZZ"]:
    r = acm.resolve_code(idx, q)
    print(f"  resolve({q!r}) kind={r['kind']} count={r['count']} hint={(r.get('hint') or {}).get('reason')}")
# loose<3 时绝不返回子串层命中
sub = []
for q in ["1", "J", "AB", "ZZ", "QQ", "XY", "％", "－"]:
    r = acm.resolve_code(idx, q)
    if len(acm.normalize_code(q)["loose"]) < 3 and r["kind"] == "fuzzy":
        sub.append(q)
print(f"  loose<3 却返回 fuzzy 的输入 = {sub}（应为 []）")
