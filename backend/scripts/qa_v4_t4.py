# -*- coding: utf-8 -*-
"""QA v4 · T4：R5(最短长度) / R6(子串两侧 loose) 的副作用与假阳性"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)
print("FUZZY_MIN_LEN =", acm.FUZZY_MIN_LEN)

print("\n=== R5：只影响子串层，不误伤精确命中 ===")
print("输入 | loose | len(loose) | kind | exact | count | hint | 精确层有命中?")
for q in ["G1", "J1", "J-1", "42U", "F3b", "配电箱", "1050", "1", "J", "AB", "G-1", "GE"]:
    n = acm.normalize_code(q)
    loose = n["loose"]
    # 精确层是否有命中（复现 resolve 的精确部分）
    exact_hits = 0
    if loose:
        exact_hits += len(idx["device_code"].get(loose, []))
        exact_hits += len(idx["alias"].get(loose, []))
        exact_hits += len(idx["brand_serial"].get(loose, []))
        exact_hits += len(idx["serial_no"].get(loose, []))
    r = acm.resolve_code(idx, q)
    print(f"  {q!r:<10} {loose!r:<14} {len(loose):<10} {r['kind']:<10} {r['exact']!s:<5} "
          f"{r['count']:<6} {str(r.get('hint'))[:40]:<42} exact_hits={exact_hits}")

print("\n=== R5 边界：len(loose)==2 与 ==3（两侧各取样） ===")
# 从真实键里取 len(loose)==2 和 ==3 的
k2 = [k for k in idx["device_code"] if len(k) == 2][:5]
k3 = [k for k in idx["device_code"] if len(k) == 3][:5]
print("  len==2 device_code 键:", k2)
for k in k2[:3]:
    r = acm.resolve_code(idx, k)
    print(f"    q={k!r} kind={r['kind']} count={r['count']} hint={r.get('hint')}")
print("  len==3 device_code 键:", k3)
for k in k3[:3]:
    r = acm.resolve_code(idx, k)
    print(f"    q={k!r} kind={r['kind']} count={r['count']}")
# 无精确命中、纯 2 字符 → 应被 R5 挡（count=0 + 过短 hint）
for q in ["ZZ", "QQ", "XY"]:
    r = acm.resolve_code(idx, q)
    print(f"    (无命中2字符) q={q!r} kind={r['kind']} count={r['count']} hint={r.get('hint')}")

print("\n=== R6：五种分隔符变体应与无分隔一致 ===")
variants = ["GE2FKTJF101", "GE-2F-KTJF-101", "GE_2F_KTJF_101", "GE.2F.KTJF.101",
            "GE/2F/KTJF/101", "ge 2f ktjf 101", "全角 ＧＥ１Ｆ..."]
for q in ["GE2FKTJF101", "GE-2F-KTJF-101", "GE_2F_KTJF_101", "GE.2F.KTJF.101",
          "GE/2F/KTJF/101", "ge 2f ktjf 101"]:
    r = acm.resolve_code(idx, q)
    codes = [(c["device_code"], c["match_type"], c["confidence"]) for c in r["candidates"]]
    print(f"  {q!r:<22} loose={r['normalized']['loose']!r:<14} kind={r['kind']:<11} "
          f"count={r['count']} -> {codes}")

print("\n=== R6：模糊命中 matched_value 必须回原值 + 全角归一 ===")
for q in ["ge 2f ktjf", "ＧＥ１Ｆ", "ＧＥ２ＦＫＴＪＦ", "配电箱", "10 50"]:
    r = acm.resolve_code(idx, q)
    print(f"  q={q!r:<14} loose={r['normalized']['loose']!r:<14} kind={r['kind']:<11} count={r['count']}")
    for c in r["candidates"][:3]:
        mv = c["matched_value"]
        is_loose = (mv == acm.normalize_code(mv)["loose"])
        print(f"      {c['device_code']:<16} {c['match_type']:<16} field={c['match_field']:<12} "
              f"matched_value={mv!r}  (等于loose? {is_loose})")

print("\n=== R6 假阳性搜索：子串 loose 是否把不相关设备误纳 ===")
# 抽样含分隔符的字段值，用其 loose 片段作 needle，看命中的设备是否合理
for q in ["IPC", "IPCL2A4FW", "5950", "AC15", "42U"]:
    r = acm.resolve_code(idx, q)
    codes = [c["device_code"] for c in r["candidates"][:5]]
    print(f"  q={q!r:<12} kind={r['kind']:<10} count={r['count']:<6} 前5={codes}")

print("\n=== R6 是否顺带改动精确层（应只放宽带子串层） ===")
# 精确层：用一个精确编号，确认仍按键精确匹配、不掺入其它
for q in ["G-1D9APt", "105000620952", "J-1"]:
    r = acm.resolve_code(idx, q)
    types = sorted({c["match_type"] for c in r["candidates"]})
    print(f"  q={q!r}: kind={r['kind']} match_types={types}")
