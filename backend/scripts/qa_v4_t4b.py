# -*- coding: utf-8 -*-
"""QA v4 · T4b：R6 假阳性搜索 —— v3(原串子串) vs v4(loose 子串) 的命中差异"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

BRAND = acm.FUZZY_BRAND_FIELDS
OTHER = acm.FUZZY_OTHER_FIELDS


def v3_fuzzy(q):
    needle = (q or "").strip().lower()
    if not needle:
        return set()
    out = set()
    for r in rows:
        for f in BRAND:
            if needle in str(r.get(f) or "").lower():
                out.add(r["device_code"])
                break
        else:
            for f in OTHER:
                if needle in str(r.get(f) or "").lower():
                    out.add(r["device_code"])
                    break
    return out


def v4_fuzzy(q):
    return {c["device_code"] for c in acm._fuzzy_hits(idx, q)}


NEEDLES = ["ge 2f ktjf", "ＧＥ１Ｆ", "1050", "AC1.5", "ipcl2a4fw", "G1D9APT",
           "配电箱", "ge1f-pdf", "5950-36", "ab", "42U", "10 50"]
print("needle | loose | v3命中 | v4命中 | 新增(R6放开) | 新增中'原值不含needle原串'的样本")
for q in NEEDLES:
    a, b = v3_fuzzy(q), v4_fuzzy(q)
    new = b - a
    loose = acm.normalize_code(q)["loose"]
    print(f"\n  q={q!r:<14} loose={loose!r:<10} v3={len(a):<5} v4={len(b):<5} new={len(new)}")
    shown = 0
    for code in list(new)[:40]:
        r = next(x for x in rows if x["device_code"] == code)
        # 找命中的字段值
        for f in BRAND + OTHER:
            v = str(r.get(f) or "")
            if v and loose in acm.normalize_code(v)["loose"]:
                raw_contains = (q.strip().lower() in v.lower())
                print(f"      NEW {code:<16} field={f:<12} value={v!r} 原串含needle? {raw_contains}")
                shown += 1
                break
        if shown >= 5:
            break
