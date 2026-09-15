# -*- coding: utf-8 -*-
"""QA v4 · T3 交叉对账：8977 个 device_code resolve 的 kind 全量分布"""
import os
import sys
from collections import Counter

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

cnt = Counter()
amb_list = []
for r in rows:
    code = r.get("device_code")
    if not code:
        continue
    res = acm.resolve_code(idx, code)
    cnt[res["kind"]] += 1
    if res["kind"] == "ambiguous":
        amb_list.append((code, r.get("source"), res.get("shared_count")))

total = sum(cnt.values())
print(f"total = {total}")
for k, n in cnt.most_common():
    print(f"  {k:<16} {n:<6} {n/total*100:.4f}%")
print(f"\nambiguous device_codes ({len(amb_list)}):")
for c, s, sc in amb_list:
    print(f"  {c!r:<22} source={s:<12} shared_count={sc}")
