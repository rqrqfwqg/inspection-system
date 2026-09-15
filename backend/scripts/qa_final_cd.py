# -*- coding: utf-8 -*-
"""QA final · C（hint 三档反例扫描 + 契约）+ D（tier0 可达性）"""
import json
import os
import sys

import qa_common as Q

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asset_code_match as acm  # noqa: E402

db = Q.get_session()
rows = Q.load_rows(db)
idx = acm.build_match_index(db, rows)

T2 = "在候选中确认"
T1 = "当前仅定位到 1 台设备"
T0 = "当前未能定位到具体设备"

shared_keys = sorted(k for k, v in idx["shared_values"].items() if v >= 2)
print(f"shared_values 计数>=2 的键 = {len(shared_keys)}")

tier = {">=2": 0, "==1": 0, "==0": 0}
no_hint = 0
bad_amb_hint, bad_nonamb_sc = 0, 0
counterexamples = []
dist_by_len = {">=3": 0, "<3": 0}

for k in shared_keys:
    r = acm.resolve_code(idx, k)
    reason = (r.get("hint") or {}).get("reason", "")
    cnt = r["count"]
    if r.get("hint") is None or not reason:
        no_hint += 1
    if T2 in reason:
        tier[">=2"] += 1
        if cnt < 2:
            counterexamples.append((k, "tier>=2 但 count<2", cnt, reason))
    elif T1 in reason:
        tier["==1"] += 1
        if cnt != 1:
            counterexamples.append((k, "tier1 但 count!=1", cnt, reason))
    elif T0 in reason:
        tier["==0"] += 1
        if cnt != 0:
            counterexamples.append((k, "tier0 但 count!=0", cnt, reason))
        dist_by_len["<3"] += 1
    else:
        # 有 hint 但不是三档歧义口径
        pass

print(f"分档分布：tier>=2={tier['>=2']}  tier==1={tier['==1']}  tier==0={tier['==0']}  no_hint={no_hint}")
print(f"三档合计 = {tier['>=2'] + tier['==1'] + tier['==0']}（应 = {len(shared_keys)}）")
print(f"反例数 = {len(counterexamples)}")
for c in counterexamples:
    print("   ", c)

# 契约：ambiguous ⇒ hint 在、can_observe=False；非 ambiguous ⇒ 无 shared_count 键
# 在全体向量（含 device_code/alias/brand_serial/serial_no 键）上验证
V = set(r.get("device_code") for r in rows if r.get("device_code"))
V |= set(idx["brand_serial"].keys()) | set(idx["alias"].keys()) | set(idx["serial_no"].keys()) | set(shared_keys)
print(f"\n契约扫描向量数 = {len(V)}")
for v in sorted(V):
    r = acm.resolve_code(idx, v)
    amb = (r["kind"] == "ambiguous")
    if amb:
        h = r.get("hint")
        if not h or h.get("can_observe") is not False:
            bad_amb_hint += 1
            if bad_amb_hint <= 5:
                print(f"    违规 ambiguous 无 hint/can_observe: q={v!r} {r.get('hint')}")
    else:
        if "shared_count" in r:
            bad_nonamb_sc += 1
            if bad_nonamb_sc <= 5:
                print(f"    违规 非ambiguous 带 shared_count: q={v!r} kind={r['kind']} sc={r['shared_count']}")
print(f"ambiguous 缺 hint/can_observe 违规 = {bad_amb_hint}")
print(f"非 ambiguous 却带 shared_count 违规 = {bad_nonamb_sc}")

print("\n=== D · tier0 可达性 ===")
short_shared = [k for k in shared_keys if len(k) < 3]
print(f"实数据 shared_values 中 len(loose)<3 且计数>=2 的键 = {len(short_shared)}")
for k in short_shared[:30]:
    r = acm.resolve_code(idx, k)
    print(f"    {k!r} shared={idx['shared_values'][k]} -> kind={r['kind']} count={r['count']} "
          f"reason={(r.get('hint') or {}).get('reason','')[:30]}")
# len>=3 的共用键是否都 count>=1
z = [k for k in shared_keys if len(k) >= 3 and acm.resolve_code(idx, k)["count"] == 0]
print(f"len(loose)>=3 且 count==0 的共用键 = {len(z)}  （若为 0，支持『tier0 只能由 len<3 触发』）")

# 合成 tier0（内存行，不写 fixture）
def srow(code, src, **kw):
    d = {"device_code": code, "source": src, "brand_model": "", "asset_code": "",
         "serial_no": "", "name": "N", "location": "", "area": ""}
    d.update(kw)
    return d


syn = acm.build_match_index(None, [srow("DEV1", "devices", asset_code="AB"),
                                   srow("DEV2", "devices", asset_code="AB")])
r0 = acm.resolve_code(syn, "AB")
print(f"\n合成 tier0: q='AB'（两行 asset_code='AB'，无其它桶命中）")
print(f"    -> kind={r0['kind']} exact={r0['exact']} count={r0['count']} "
      f"shared_count={r0.get('shared_count')} hint={r0.get('hint')}")

syn2 = acm.build_match_index(None, [srow("AB", "devices"), srow("A-B", "ledger_only")])
r2 = acm.resolve_code(syn2, "AB")
print(f"\n合成对照: q='AB'（两行 device_code='AB'/'A-B'，均命中 device_code 桶）")
print(f"    -> kind={r2['kind']} exact={r2['exact']} count={r2['count']} "
      f"shared_count={r2.get('shared_count')} hint={r2.get('hint')}")
