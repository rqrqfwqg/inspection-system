# -*- coding: utf-8 -*-
"""QA v4 · T3b：深挖 2 个 ambiguous device_code + 11 个已登记 J 码来源"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)
sh = idx["shared_values"]
by_code = {r.get("device_code"): r for r in rows}

print("=== 2 个 ambiguous 的 device_code 详情 ===")
for code in ("G-1D5ATx1", "WP-2D7APk1"):
    loose = acm.normalize_code(code)["loose"]
    print(f"\n### {code!r}  loose={loose!r}  shared_count={sh.get(loose)}")
    r = acm.resolve_code(idx, code)
    print(f"  resolve: kind={r['kind']} exact={r['exact']} count={r['count']} shared_count={r.get('shared_count')}")
    for c in r["candidates"]:
        print(f"    cand {c['device_code']:<16} {c['match_type']:<20} conf={c['confidence']} "
              f"src={c['source']} mv={c['matched_value']!r}")
    # 找出所有贡献该 loose 的行（4 来源）
    print("  贡献该 loose 的行：")
    for r2 in rows:
        for f in acm.SHARED_VALUE_FIELDS:
            if acm.normalize_code(r2.get(f))["loose"] == loose:
                print(f"    [{f}] {r2.get('device_code')!r} src={r2.get('source')} "
                      f"value={r2.get(f)!r}")
        ex = acm.normalize_code(acm.extract_serial_from_brand(r2.get("brand_model")))["loose"]
        if ex == loose:
            print(f"    [brand_extract] {r2.get('device_code')!r} src={r2.get('source')} "
                  f"brand_model={r2.get('brand_model')!r} -> {acm.extract_serial_from_brand(r2.get('brand_model'))!r}")
    # 该 code 自身行
    self_row = by_code.get(code)
    if self_row:
        print(f"  自身行：src={self_row.get('source')} brand_model={self_row.get('brand_model')!r} "
              f"asset_code={self_row.get('asset_code')!r} serial_no={self_row.get('serial_no')!r}")

print("\n=== 11 个已登记 J 码 loose 在 shared_values 的来源（shared 应=1） ===")
for code in ["J-1", "J-2", "J-10", "J-13"]:
    loose = acm.normalize_code(code)["loose"]
    print(f"\n### {code!r} loose={loose!r} shared={sh.get(loose)}")
    for r2 in rows:
        for f in acm.SHARED_VALUE_FIELDS:
            if acm.normalize_code(r2.get(f))["loose"] == loose:
                print(f"    [{f}] {r2.get('device_code')!r} src={r2.get('source')} value={r2.get(f)!r}")
        ex = acm.normalize_code(acm.extract_serial_from_brand(r2.get("brand_model")))["loose"]
        if ex == loose:
            print(f"    [brand_extract] {r2.get('device_code')!r} -> "
                  f"{acm.extract_serial_from_brand(r2.get('brand_model'))!r}")
