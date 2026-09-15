# -*- coding: utf-8 -*-
"""QA v4 · T6：R7 契约（count = 总命中数，不截断）+ count 与 shared_count 关系"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

print("=== R7-1 count 不受 limit 截断（count > len(candidates)）===")
for q in ["配电箱", "595036PME", "1050", "42U"]:
    r0 = acm.resolve_code(idx, q, limit=8)
    r1 = acm.resolve_code(idx, q, limit=20)
    print(f"  q={q!r:<12} count={r0['count']:<6} | limit=8: len(cands)={len(r0['candidates'])} "
          f"| limit=20: len(cands)={len(r1['candidates'])} | kind={r0['kind']}")
    assert r0["count"] == r1["count"], "count 不应随 limit 变"

print("\n=== R7-2 count 与 shared_count：相等是必然还是巧合？ ===")
print("count = len(uniq) = 精确层命中的【去重 device_code 数】")
print("shared_count = 该 loose 在 4 来源(asset_code/serial_no/brand_model整串/抽取)上覆盖的【合并行数】")
print()
cases = ["595036PME", "0512001", "BQL-B1-SB-01", "J-1", "42U", "G-1D9APt"]
print("输入 | count | shared_count | kind | 相等?")
for q in cases:
    r = acm.resolve_code(idx, q)
    sc = r.get("shared_count")
    eq = (r["count"] == sc) if sc is not None else None
    print(f"  {q!r:<14} count={r['count']:<6} shared_count={sc!s:<6} kind={r['kind']:<11} "
          f"{'相等' if eq else ('不等' if eq is False else '—')}")

print("\n判定：")
print("  - q='0512001' count=1 但 shared_count=447（alias 1:1 命中 1 行，共用却有 447 行）→ 不相等；")
print("  - q='J-1' count=3 但 shared_count=1 → 不相等；")
print("  - 只有 q='595036PME' 这类「命中行集合恰好与共用行集合相同」时两者才相等 → 属巧合，非定义使然。")

print("\n=== 附：ambiguous 时 exact=False 且带 hint ===")
for q in ["595036PME", "0512001", "BQL-B1-SB-01"]:
    r = acm.resolve_code(idx, q)
    print(f"  q={q!r:<14} kind={r['kind']} exact={r['exact']} "
          f"hint.can_observe={(r.get('hint') or {}).get('can_observe')}")
