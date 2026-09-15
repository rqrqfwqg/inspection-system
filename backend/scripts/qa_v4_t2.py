# -*- coding: utf-8 -*-
"""QA v4 · T2：零误伤硬验（指定键必须未被推高到 >=2）"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)
sh = idx["shared_values"]

CASES = [
    # (输入, 期望 shared_count, 期望非ambiguous?)
    ("G-1D9APt",              1, True),
    ("J-1",                   1, True),
    ("J1",                    1, True),
    ("J-4",                   1, True),
    ("105000620952",          0, True),
    ("152100424110742M",      1, True),
    ("10430201211100004970",  0, True),
    ("GE-2F-KTJF-101",        0, True),
    ("GW2F-KTJF-101",         0, True),
    ("0512001",             447, False),
    ("BQL-B1-SB-01",          3, False),
]

print("输入 | loose | shared_values | resolve.kind | exact | count | 期望sc | 判定")
print("-" * 100)
allok = True
for q, exp_sc, exp_nonamb in CASES:
    loose = acm.normalize_code(q)["loose"]
    sc = sh.get(loose, 0)
    r = acm.resolve_code(idx, q)
    nonamb = (r["kind"] != "ambiguous")
    ok = (sc == exp_sc) and (nonamb == exp_nonamb)
    allok &= ok
    print(f"{q!r:<24} {loose!r:<16} {sc:<5} {r['kind']:<11} {r['exact']!s:<5} "
          f"{r['count']:<5} {exp_sc:<6} {'OK' if ok else 'FAIL'}")
    for c in r["candidates"][:4]:
        print(f"      cand {c['device_code']:<16} {c['match_type']:<20} conf={c['confidence']} "
              f"src={c['source']} demoted={c['source_demoted']}")
print("-" * 100)
print("综合：", "PASS（全部未被误推到 >=2）" if allok else "FAIL（见上）")

# 专门确认 J 系列 device_code 不在 shared_values（R3/R4 不得把它们计入）
print("\nJ 系列 loose 在 shared_values 的键：")
for q in ("J-1", "J1", "J-4", "J4"):
    loose = acm.normalize_code(q)["loose"]
    print(f"    {q!r} -> loose={loose!r} shared_values.get={sh.get(loose, 0)}")
