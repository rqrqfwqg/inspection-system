# -*- coding: utf-8 -*-
"""QA 独立验证 · R2 过触发/欠触发分析（判定是否会把设备绑错）"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)
sh = idx["shared_values"]

print("=" * 70)
print("R2 过触发 / 欠触发分析")
print("=" * 70)

# --- 1) 机身编号(brand_serial)：唯一(1行)但被判歧义 = 过触发 ---
over = []
under = []
for key, entries in idx["brand_serial"].items():
    n_rows = len({e[0].get("device_code") if not (len(e) == 3 and e[2] == "observation") else e[0]
                  for e in entries})
    sc = sh.get(key, 0)
    if n_rows == 1 and sc >= 2:
        over.append((key, sc, entries[0]))
    if n_rows >= 2 and sc < 2:
        under.append((key, n_rows, sc))
print(f"[1] 机身编号 brand_serial：唯一(1行)却被判歧义(过触发) = {len(over)}")
for k, sc, e in over[:8]:
    r = e[0] if not (isinstance(e, tuple) and len(e) == 3 and e[2] == "observation") else None
    code = r.get("device_code") if r else e[0]
    print(f"      key={k!r} shared_count={sc} code={code}")
print(f"[2] 机身编号 brand_serial：≥2 行共用却未判歧义(欠触发) = {len(under)}")
for k, nr, sc in under[:8]:
    print(f"      key={k!r} rows={nr} shared_count={sc}")

# --- 3) 唯一别名/序列号是否被误判歧义 ---
print("\n[3] alias 空间：唯一别名却被判歧义")
alias_over = []
for key, entries in idx["alias"].items():
    if len(entries) == 1 and sh.get(key, 0) >= 2:
        alias_over.append((key, sh.get(key), entries[0]))
print(f"    唯一 alias 被判歧义 = {len(alias_over)} / alias键 {len(idx['alias'])}")
for k, sc, e in alias_over[:8]:
    print(f"      key={k!r} shared_count={sc} -> canonical={e[0]!r} alias={e[1]!r}")

# --- 4) 危险面：resolve 返回「单一候选且 exact=True」的输入，其候选是否可能错 ---
#     枚举 alias 空间（1:1 别名 = 最可能产生"单一自信答案"的路径）
print("\n[4] 单一候选且 exact=True 的 alias 命中中，shared_count>=2 的（应全判 ambiguous）")
bad = 0
for key, entries in idx["alias"].items():
    r = acm.resolve_code(idx, entries[0][1])  # 用 alias 原值查询
    if r["count"] == 1 and r["exact"] is True and r.get("shared_count") is None:
        # 单一候选且被判 exact，但 alias 原值的 shared_count 却 >=2 → 漏网
        if sh.get(acm.normalize_code(entries[0][1])["loose"], 0) >= 2:
            bad += 1
            if bad <= 8:
                print(f"      LEAK alias={entries[0][1]!r} -> {r['candidates'][0]['device_code']} "
                      f"conf={r['candidates'][0]['confidence']}")
print(f"    → 漏网（单一 exact 且 shared>=2）= {bad}")

# --- 5) 全库：多少输入会得到「单一候选且 exact=True」 ---
print("\n[5] 抽样统计 resolve 结果分布（以 device_code/brand_extract/alias/serial_no 键为输入）")
from collections import Counter
cnt = Counter()
sample = []
sample += [(k, "device_code") for k in list(idx["device_code"])[:2000]]
sample += [(k, "brand_serial") for k in list(idx["brand_serial"])[:2000]]
sample += [(k, "alias") for k in list(idx["alias"])[:2000]]
sample += [(k, "serial_no") for k in list(idx["serial_no"])[:2000]]
for k, src in sample:
    r = acm.resolve_code(idx, k)
    key = ("ambiguous" if r["kind"] == "ambiguous"
           else f"{r['kind']}|exact={r['exact']}|count={'1' if r['count']==1 else '2+'}")
    cnt[key] += 1
for k, v in cnt.most_common():
    print(f"      {k:<28} {v}")
