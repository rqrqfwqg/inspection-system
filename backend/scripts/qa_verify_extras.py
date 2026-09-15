# -*- coding: utf-8 -*-
"""QA 独立验证 · 补遗：
  (a) 随机 20 个输入值 shared_count 与我独立计数比对（item 4 要求）
  (b) 全角/部分输入在精确层落空时，fuzzy 是否 NFKC 归一（潜在假阴性）
  (c) 跨进程签名（供不同 PYTHONHASHSEED 比对）
"""
import json
import os
import random
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

MODE = sys.argv[1] if len(sys.argv) > 1 else "all"
db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

if MODE in ("all", "shared"):
    # 我独立重算（设计口径）
    SHARED = acm.SHARED_VALUE_FIELDS
    total = {}
    for r in rows:
        seen = set()
        for f in SHARED:
            lv = acm.normalize_code(r.get(f))["loose"]
            if lv:
                seen.add(lv)
        for lv in seen:
            total[lv] = total.get(lv, 0) + 1
    rnd = random.Random(4242)
    keys = list(total.keys())
    sample = rnd.sample(keys, 20) + ["0512001", "BQL-B1-SB-01"]
    print("(a) 随机 20 + 2 基准：shared_count 内核 vs 独立计数")
    bad = 0
    for k in sample:
        lk = acm.normalize_code(k)["loose"]
        mine = total.get(lk, 0)
        kern = idx["shared_values"].get(lk, 0)
        r = acm.resolve_code(idx, k)
        reported = r.get("shared_count")
        exp_report = kern if kern >= 2 else None
        ok = (mine == kern) and (reported == exp_report)
        bad += not ok
        print(f"    {k!r:<26} 我={mine:<4} 内核={kern:<4} resolve.shared_count={reported!r:<5} "
              f"kind={r['kind']:<10} {'OK' if ok else 'MISMATCH'}")
    print(f"  → 不一致 {bad}  {'PASS' if bad == 0 else 'FAIL'}")

if MODE in ("all", "fuzzy"):
    print("\n(b) 全角落空时 fuzzy 是否归一（潜在假阴性）")
    for q in ["ＧＥ１Ｆ", "ＧＥ１Ｆ－ＰＤＦ", "ge 2f ktjf", "ＧＥ２ＦＫＴＪＦ", "配电箱Ｇ", "电箱"]:
        r = acm.resolve_code(idx, q)
        top = r["candidates"][0] if r["candidates"] else {}
        print(f"    q={q!r:<16} loose={r['normalized']['loose']!r:<16} kind={r['kind']:<10} "
              f"count={r['count']:<6} top={top.get('device_code','')!r}")
    print("    对照：q='GE1F'（半角）")
    r = acm.resolve_code(idx, "GE1F")
    print(f"    q='GE1F' loose={r['normalized']['loose']!r} kind={r['kind']} count={r['count']}")

if MODE in ("all", "sig"):
    INPUTS = ["G-1D9APt", "0512001", "BQL-B1-SB-01", "GE-2F-KTJF-101", "J-1",
              "105000620952", "152100424110742M", "配电箱", "J", "1"]
    sig = {}
    for q in INPUTS:
        r = acm.resolve_code(idx, q)
        sig[q] = [[c["device_code"], c["match_type"], c["confidence"], c["source_demoted"]]
                  for c in r["candidates"]] + [["__count__", r["count"], r["kind"], r["exact"]]]
    samp = sorted(idx["shared_values"].items())[::37]
    print("SIG=" + json.dumps({"sig": sig, "shared_sample": samp}, ensure_ascii=False, sort_keys=True))
