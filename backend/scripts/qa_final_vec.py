# -*- coding: utf-8 -*-
"""QA final · 向量集定义敏感性（解释与 team-lead 14275/13906 的差异）"""
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

dc = {r.get("device_code") for r in rows if r.get("device_code")}
sh_all = set(idx["shared_values"].keys())
sh_2 = {k for k, v in idx["shared_values"].items() if v >= 2}
bs = set(idx["brand_serial"].keys())
al = set(idx["alias"].keys())
sn = set(idx["serial_no"].keys())

def U(*sets):
    o = set()
    for s in sets:
        o |= s
    return len(o)

print(f"|dedup device_code| = {len(dc)}")
print(f"|shared_values 全键| = {len(sh_all)}")
print(f"|shared_values >=2|  = {len(sh_2)}")
print(f"|brand_serial keys|  = {len(bs)}")
print(f"|alias keys|         = {len(al)}")
print(f"|serial_no keys|     = {len(sn)}")
print()
print(f"V_mine  dc ∪ sh>=2 ∪ bs ∪ al ∪ sn           = {U(dc, sh_2, bs, al, sn)}")
print(f"V_alt1  dc ∪ sh_all ∪ bs ∪ al ∪ sn          = {U(dc, sh_all, bs, al, sn)}")
print(f"V_alt2  dc ∪ bs ∪ al ∪ sn                   = {U(dc, bs, al, sn)}")
print(f"V_alt3  dc ∪ sh>=2 ∪ bs ∪ al ∪ sn ∪ sh_all  = {U(dc, sh_2, bs, al, sn, sh_all)}")
# 逐集合关系
print()
print(f"dc ∩ bs = {len(dc & bs)}, dc ∩ al = {len(dc & al)}, dc ∩ sn = {len(dc & sn)}")
print(f"sh_2 ⊆ sh_all ? {sh_2 <= sh_all}")
print(f"sh>=2 中不属于任何桶(DC/BS/AL/SN)的键数 = {len(sh_2 - (dc|bs|al|sn))}")
