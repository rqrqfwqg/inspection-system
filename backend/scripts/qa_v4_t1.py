# -*- coding: utf-8 -*-
"""QA v4 · T1：独立重算四来源 shared_values（逐键 diff）"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)
kern = idx["shared_values"]

FIELDS = acm.SHARED_VALUE_FIELDS
print("SHARED_VALUE_FIELDS =", FIELDS, " (R4 会额外并入 brand_model 抽取结果)")
print("行数 =", len(rows))

# ---- 独立重算（四来源、loose、合并行、行内去重）----
per_src = {"asset_code": {}, "serial_no": {}, "brand_model": {}, "brand_extract": {}}
total = {}
for r in rows:
    seen = set()
    for f in FIELDS:
        lv = acm.normalize_code(r.get(f))["loose"]
        if lv:
            per_src[f][lv] = per_src[f].get(lv, 0) + 1
            seen.add(lv)
    ex = acm.normalize_code(acm.extract_serial_from_brand(r.get("brand_model")))["loose"]
    if ex:
        per_src["brand_extract"][ex] = per_src["brand_extract"].get(ex, 0) + 1
        seen.add(ex)
    for lv in seen:
        total[lv] = total.get(lv, 0) + 1

shared_set = {k for k, v in total.items() if v >= 2}
print(f"\n[总键] 我={len(total)}  内核={len(kern)}  {'一致' if len(total)==len(kern) else '不一致'}")
print(f"[共用键(>=2)] 我={len(shared_set)}  内核={len([1 for v in kern.values() if v>=2])}")

# 逐键 diff
diff = {k for k in set(kern) | set(total) if kern.get(k, 0) != total.get(k, 0)}
print(f"\n[逐键 diff] 不一致键数 = {len(diff)}  {'一致 PASS' if not diff else 'FAIL'}")
for k in sorted(diff)[:20]:
    print(f"    {k!r}: 内核={kern.get(k)} 我={total.get(k)}")

# 单来源共用键
print("\n[单来源 >=2 键数]")
exp = {"asset_code": 109, "serial_no": 113, "brand_model": 243, "brand_extract": 137}
for f in ("asset_code", "serial_no", "brand_model", "brand_extract"):
    n = len([1 for v in per_src[f].values() if v >= 2])
    print(f"    {f:<14} = {n:<5} (期望 {exp[f]})  {'OK' if n==exp[f] else 'DIFF'}")

# 头部共用者
print("\n[头部共用者 Top10]")
for k, v in sorted(total.items(), key=lambda x: -x[1])[:10]:
    print(f"    {k!r:<18} {v}")
exp_head = {"IPCL2A4FW": 1364, "AC15": 268, "IPCL354IR": 235, "42U": 212,
            "SSRC2": 162, "595036PME": 145, "EMG1200": 133}
print("  期望头部：IPC-L2A4-FW=1364 AC1.5=268 IPC-L354-IR=235 42U=212 SSRC-2=162 5950-36PM-E=145 EMG1200=133")
for k, e in exp_head.items():
    got = total.get(k)
    print(f"    {k:<14} 我={got}  期望={e}  {'OK' if got==e else 'DIFF'}")
