# -*- coding: utf-8 -*-
"""QA final · B：旧内核 vs 当前内核，5 结构字段零差异（kind/exact/count/shared_count/candidates）

向量集 = 去重 device_code ∪ shared_values(计数>=2) ∪ brand_serial 键 ∪ alias 键 ∪ serial_no 键
对比两个旧内核（.bak_095004 = v4；.bak_110449 = 仅缺 hint 分档）
"""
import importlib.machinery
import importlib.util
import json
import os
import sys

import qa_common as Q

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
sys.path.insert(0, _BACKEND)

import asset_code_match as acm_new  # noqa: E402

BAKS = [
    r"asset_code_match.py.bak_20260914_095004",
    r"asset_code_match.py.bak_20260914_110449",
]


def load_mod(name, path):
    loader = importlib.machinery.SourceFileLoader(name, path)
    spec = importlib.util.spec_from_loader(name, loader)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    loader.exec_module(m)
    return m


db = Q.get_session()
rows = Q.load_rows(db)
idx_new = acm_new.build_match_index(db, rows)

# ---- 向量集 ----
V = set()
for r in rows:
    c = r.get("device_code")
    if c:
        V.add(c)
V |= {k for k, v in idx_new["shared_values"].items() if v >= 2}
V |= set(idx_new["brand_serial"].keys())
V |= set(idx_new["alias"].keys())
V |= set(idx_new["serial_no"].keys())
V = sorted(V)
print(f"向量集大小 = {len(V)}")


def sig(resp):
    return (
        resp.get("kind"),
        resp.get("exact"),
        resp.get("count"),
        resp.get("shared_count"),          # None 表示键不存在
        json.dumps(resp.get("candidates"), ensure_ascii=False, sort_keys=True, default=str),
    )


for bak in BAKS:
    path = os.path.join(_BACKEND, bak)
    print(f"\n=== 对比旧内核 {bak} ===")
    if not os.path.exists(path):
        print("  不存在，跳过")
        continue
    m = load_mod("acm_old_" + bak[-6:], path)
    idx_old = m.build_match_index(db, rows)
    diff = {"kind": 0, "exact": 0, "count": 0, "shared_count": 0, "candidates": 0}
    examples = []
    for v in V:
        ro = m.resolve_code(idx_old, v)
        rn = acm_new.resolve_code(idx_new, v)
        so, sn = sig(ro), sig(rn)
        fields = ["kind", "exact", "count", "shared_count", "candidates"]
        bad = False
        for i, f in enumerate(fields):
            if so[i] != sn[i]:
                diff[f] += 1
                bad = True
        if bad and len(examples) < 15:
            examples.append((v, dict(zip(fields, so)), dict(zip(fields, sn))))
    print(f"  向量数={len(V)}  差异：kind={diff['kind']} exact={diff['exact']} "
          f"count={diff['count']} shared_count={diff['shared_count']} candidates={diff['candidates']}")
    print(f"  五字段全 0 ? {'PASS' if sum(diff.values()) == 0 else 'FAIL'}")
    for v, o, n in examples:
        print(f"    示例 q={v!r}\n      旧={o}\n      新={n}")
